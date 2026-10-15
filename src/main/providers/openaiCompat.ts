import { sseEvents } from './sse'
import {
  COMPLETE_TIMEOUT_MS,
  ChatMessage,
  ChatRequest,
  LLMProvider,
  ProviderError,
  STREAM_TIMEOUT_MS,
  errorFromStatus,
  fromFetchError
} from './types'

type Opts = { id: string; baseUrl: string; apiKey: string | null; fetch?: typeof fetch }

function toWire(messages: ChatMessage[]) {
  return messages.map((m) => {
    if (typeof m.content === 'string') return { role: m.role, content: m.content }
    return {
      role: m.role,
      content: m.content.map((p) =>
        p.type === 'text'
          ? { type: 'text', text: p.text }
          : { type: 'image_url', image_url: { url: `data:${p.mime};base64,${p.base64}` } }
      )
    }
  })
}

// OpenRouter and others report failures mid-stream as {"error": {...}}.
function streamError(err: { code?: number | string; message?: string }): ProviderError {
  const code = Number(err.code)
  if (code === 401 || code === 403) return new ProviderError('auth', `Authentication failed (${code})`, code)
  if (code === 429 || code === 529) return new ProviderError('rate_limit', err.message ?? 'Rate limit reached', code)
  return new ProviderError('other', `Provider error: ${err.message ?? 'unknown'}`)
}

export function createOpenAICompatProvider(opts: Opts): LLMProvider {
  const f = opts.fetch ?? fetch
  const url = opts.baseUrl.replace(/\/$/, '') + '/chat/completions'

  function headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' }
    if (opts.apiKey) h.Authorization = `Bearer ${opts.apiKey}`
    return h
  }

  async function send(req: ChatRequest, stream: boolean): Promise<Response> {
    let res: Response
    try {
      res = await f(url, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ model: req.model, messages: toWire(req.messages), max_tokens: req.maxTokens, stream }),
        signal: req.signal ?? AbortSignal.timeout(stream ? STREAM_TIMEOUT_MS : COMPLETE_TIMEOUT_MS)
      })
    } catch (e) {
      throw fromFetchError(e)
    }
    if (!res.ok) throw errorFromStatus(res.status, await res.text())
    return res
  }

  return {
    id: opts.id,
    async complete(req) {
      const res = await send(req, false)
      const data = (await res.json()) as { choices: { message: { content: string } }[] }
      return data.choices[0].message.content
    },
    async *stream(req) {
      const res = await send(req, true)
      try {
        for await (const ev of sseEvents(res.body!)) {
          if (ev.data === '[DONE]') return
          let json: any
          try {
            json = JSON.parse(ev.data)
          } catch {
            continue // ignore non-JSON keepalive payloads
          }
          if (json.error) throw streamError(json.error)
          const delta = json.choices?.[0]?.delta?.content
          if (delta) yield delta as string
        }
      } catch (e) {
        throw fromFetchError(e)
      }
    }
  }
}
