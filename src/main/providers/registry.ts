import { LLMProvider, ChatRequest, ProviderError } from './types'

export type ProviderConfig = {
  providerId: string
  model: string
  needsKey: boolean
  baseUrl: string
  // Tried in order when the main model is rate-limited or unavailable (e.g. a busy free model).
  fallbackModels?: string[]
}

type Deps = {
  secrets: { get(name: string): string | null }
  build(config: ProviderConfig, apiKey: string | null): LLMProvider
  sleep: (ms: number) => Promise<void>
  // Used to skip fallback models that can't read images when the request has one.
  supportsVision?: (providerId: string, model: string) => boolean
}

// With no fallbacks, a rate-limited model is retried 3 times. With fallbacks, it gets one
// short retry and then the next model is tried: a busy shared pool rarely clears in seconds.
const BACKOFF_MS = [500, 1000, 2000]
const BACKOFF_WITH_FALLBACKS_MS = [500]

// Errors that mean "this model can't answer right now", so another model may.
// Auth, moderation, and bad-request errors are not retried on other models.
function worthAnotherModel(e: unknown): boolean {
  if (!(e instanceof ProviderError)) return false
  if (e.kind === 'rate_limit' || e.kind === 'timeout') return true
  return e.status === 404 || e.status === 502 || e.status === 503 || e.status === 504 || e.status === 529
}

function hasImage(req: Omit<ChatRequest, 'model'>): boolean {
  return req.messages.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'image'))
}

export function createRegistry(deps: Deps) {
  let config: ProviderConfig | null = null
  let killed = false
  let lastModel: string | null = null

  // Every provider call passes through here: kill switch first, then key check.
  function resolve(): { provider: LLMProvider; cfg: ProviderConfig } {
    if (killed) throw new ProviderError('other', 'Network is disabled by the kill switch')
    if (!config) throw new ProviderError('other', 'No provider configured')
    let apiKey: string | null = null
    if (config.needsKey) {
      apiKey = (deps.secrets.get(config.providerId) ?? '').trim()
      if (!apiKey) throw new ProviderError('auth', `No API key saved for ${config.providerId}. Add it in Settings.`)
    }
    return { provider: deps.build(config, apiKey), cfg: config }
  }

  // The main model first, then fallbacks (only image-capable ones when the request has an image).
  function modelsFor(cfg: ProviderConfig, req: Omit<ChatRequest, 'model'>): string[] {
    const image = hasImage(req)
    const fallbacks = (cfg.fallbackModels ?? []).filter(
      (m) => m !== cfg.model && (!image || !deps.supportsVision || deps.supportsVision(cfg.providerId, m))
    )
    return [cfg.model, ...fallbacks]
  }

  return {
    configure(c: ProviderConfig) {
      config = c
    },
    // True when a call could be made now: configured, kill switch off, key present.
    // Background work (session summaries) uses this so a missing key is skipped
    // instead of becoming a failed request.
    available(): boolean {
      try {
        resolve()
        return true
      } catch {
        return false
      }
    },
    setKillSwitch(on: boolean) {
      killed = on
    },
    isKilled(): boolean {
      return killed
    },
    // The model that produced the last successful answer (it may be a fallback).
    lastModelUsed(): string | null {
      return lastModel
    },
    async call(req: Omit<ChatRequest, 'model'>): Promise<string> {
      const { provider, cfg } = resolve()
      const models = modelsFor(cfg, req)
      const backoff = models.length > 1 ? BACKOFF_WITH_FALLBACKS_MS : BACKOFF_MS
      let lastErr: unknown
      for (const model of models) {
        for (let attempt = 0; ; attempt++) {
          if (killed) throw new ProviderError('other', 'Network is disabled by the kill switch')
          try {
            const out = await provider.complete({ ...req, model })
            lastModel = model
            return out
          } catch (e) {
            lastErr = e
            const sameModelAgain = e instanceof ProviderError && e.kind === 'rate_limit' && attempt < backoff.length
            if (sameModelAgain) {
              await deps.sleep(backoff[attempt])
              continue
            }
            if (!worthAnotherModel(e)) throw e
            break // next model
          }
        }
      }
      throw lastErr
    },
    stream(req: Omit<ChatRequest, 'model'>): AsyncIterable<string> {
      // Checks run synchronously here, so a blocked call throws before any stream starts.
      const { provider, cfg } = resolve()
      const models = modelsFor(cfg, req)
      const backoff = models.length > 1 ? BACKOFF_WITH_FALLBACKS_MS : BACKOFF_MS
      return (async function* () {
        let lastErr: unknown
        for (const model of models) {
          for (let attempt = 0; ; attempt++) {
            if (killed) throw new ProviderError('other', 'Network is disabled by the kill switch')
            let yielded = false
            try {
              for await (const t of provider.stream({ ...req, model })) {
                yielded = true
                yield t
              }
              lastModel = model
              return
            } catch (e) {
              // Once text reached the user, a retry or another model would duplicate or contradict it.
              if (yielded) throw e
              lastErr = e
              const sameModelAgain = e instanceof ProviderError && e.kind === 'rate_limit' && attempt < backoff.length
              if (sameModelAgain) {
                await deps.sleep(backoff[attempt])
                continue
              }
              if (!worthAnotherModel(e)) throw e
              break // next model
            }
          }
        }
        throw lastErr
      })()
    }
  }
}
