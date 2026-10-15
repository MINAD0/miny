import { LLMProvider, ChatRequest, ProviderError } from './types'

export type ProviderConfig = {
  providerId: string
  model: string
  needsKey: boolean
  baseUrl: string
}

type Deps = {
  secrets: { get(name: string): string | null }
  build(config: ProviderConfig, apiKey: string | null): LLMProvider
  sleep: (ms: number) => Promise<void>
}

const BACKOFF_MS = [500, 1000, 2000]

export function createRegistry(deps: Deps) {
  let config: ProviderConfig | null = null
  let killed = false

  // Every provider call passes through here: kill switch first, then key check.
  function resolve(): { provider: LLMProvider; model: string } {
    if (killed) throw new ProviderError('other', 'Network is disabled by the kill switch')
    if (!config) throw new ProviderError('other', 'No provider configured')
    let apiKey: string | null = null
    if (config.needsKey) {
      apiKey = (deps.secrets.get(config.providerId) ?? '').trim()
      if (!apiKey) throw new ProviderError('auth', `No API key set for ${config.providerId}`)
    }
    return { provider: deps.build(config, apiKey), model: config.model }
  }

  async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn()
      } catch (e) {
        const retryable = e instanceof ProviderError && e.kind === 'rate_limit'
        if (!retryable || attempt >= BACKOFF_MS.length) throw e
        await deps.sleep(BACKOFF_MS[attempt])
      }
    }
  }

  return {
    configure(c: ProviderConfig) {
      config = c
    },
    setKillSwitch(on: boolean) {
      killed = on
    },
    isKilled(): boolean {
      return killed
    },
    call(req: Omit<ChatRequest, 'model'>): Promise<string> {
      return withRetry(() => {
        const { provider, model } = resolve()
        return provider.complete({ ...req, model })
      })
    },
    stream(req: Omit<ChatRequest, 'model'>): AsyncIterable<string> {
      // Checks run synchronously here, so a blocked call throws before any stream starts.
      const first = resolve()
      return (async function* () {
        for (let attempt = 0; ; attempt++) {
          const { provider, model } = attempt === 0 ? first : resolve()
          let yielded = false
          try {
            for await (const t of provider.stream({ ...req, model })) {
              yielded = true
              yield t
            }
            return
          } catch (e) {
            // Retry only before any text reached the user; a retry after that would duplicate it.
            const retryable = e instanceof ProviderError && e.kind === 'rate_limit' && !yielded
            if (!retryable || attempt >= BACKOFF_MS.length) throw e
            await deps.sleep(BACKOFF_MS[attempt])
          }
        }
      })()
    }
  }
}
