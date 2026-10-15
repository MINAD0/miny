import { sseEvents } from './sse'
import {
  COMPLETE_TIMEOUT_MS,
  ChatMessage,
  ChatRequest,
  ContentPart,
  LLMProvider,
  ProviderError,
  STREAM_TIMEOUT_MS,
  errorFromStatus,
  fromFetchError
} from './types'

type Opts = { apiKey: string; baseUrl?: string; fetch?: typeof fetch }

function toBlocks(parts: ContentPart[]) {
  return parts.map((p) =>
    p.type === 'text'
      ? { type: 'text', text: p.text }
      : { type: 'image', source: { type: 'base64', media_type: p.mime, data: p.base64 } }
  )
}

function split(messages: ChatMessage[]) {
  const system = messages
    .filter((m) => m.role === 'system')
    .map((m) =>
      typeof m.content === 'string' ? m.content : m.content.map((p) => (p.type === 'text' ? p.text : '')).join('')
    )
    .join('\n')
  const rest = messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : toBlocks(m.content) }))
  return { system, rest }
}

// Anthropic sends `event: error` mid-stream, e.g. overloaded_error. Overload and rate
// limits are retryable, so they map to rate_limit.
function streamError(err: { type?: string; message?: string }): ProviderError {
  if (err.type === 'rate_limit_error' || err.type === 'overloaded_error') {
    return new ProviderError('rate_limit', err.message ?? 'Provider is overloaded')
  }
  if (err.type === 'authentication_error' || err.type === 'permission_error') {
    return new ProviderError('auth', err.message ?? 'Authentication failed')
  }
  return new ProviderError('other', `Provider error: ${err.message ?? err.type ?? 'unknown'}`)
}

export function createAnthropicProvider(opts: Opts): LLMProvider {
  const f = opts.fetch ?? fetch
  const url = (opts.baseUrl ?? 'https://api.anthropic.com') + '/v1/messages'

  async function send(req: ChatRequest, stream: boolean): Promise<Response> {
    const { system, rest } = split(req.messages)
    let res: Response
    try {
      res = await f(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': opts.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: req.model,
          max_tokens: req.maxTokens ?? 1024,
          system: system || undefined,
          messages: rest,
          stream
        }),
        signal: req.signal ?? AbortSignal.timeout(stream ? STREAM_TIMEOUT_MS : COMPLETE_TIMEOUT_MS)
      })
    } catch (e) {
      throw fromFetchError(e)
    }
    if (!res.ok) throw errorFromStatus(res.status, await res.text())
    return res
  }

  return {
    id: 'anthropic',
    async complete(req) {
      const data = (await (await send(req, false)).json()) as { content: { type: string; text?: string }[] }
      return data.content
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('')
    },
    async *stream(req) {
      const res = await send(req, true)
      try {
        for await (const ev of sseEvents(res.body!)) {
          let json: any
          try {
            json = JSON.parse(ev.data)
          } catch {
            continue
          }
          if (ev.event === 'error' || json.type === 'error') throw streamError(json.error ?? {})
          if (json.type === 'message_stop') return
          if (json.type === 'content_block_delta' && json.delta?.type === 'text_delta') yield json.delta.text as string
        }
      } catch (e) {
        throw fromFetchError(e)
      }
    }
  }
}
