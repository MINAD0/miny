export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mime: 'image/png' | 'image/jpeg'; base64: string }

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string | ContentPart[]
}

export type ChatRequest = {
  model: string
  messages: ChatMessage[]
  maxTokens?: number
  signal?: AbortSignal
}

export interface LLMProvider {
  id: string
  complete(req: ChatRequest): Promise<string>
  stream(req: ChatRequest): AsyncIterable<string>
}

export type ProviderErrorKind = 'auth' | 'rate_limit' | 'timeout' | 'unsupported' | 'other'

export class ProviderError extends Error {
  constructor(
    public kind: ProviderErrorKind,
    message: string,
    public status?: number
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

// Default request timeouts. Streams get longer because a full answer takes time.
export const COMPLETE_TIMEOUT_MS = 60_000
export const STREAM_TIMEOUT_MS = 120_000

// Pulls the provider's own explanation out of an error body. OpenRouter, OpenAI and
// Anthropic all use { error: { message, metadata? } }; OpenRouter adds hints in metadata.
export function providerMessage(body: string): string {
  try {
    const j = JSON.parse(body)
    const e = j?.error ?? j
    const message = typeof e === 'string' ? e : (e?.message ?? '')
    const meta = (typeof e === 'object' && e?.metadata) || {}
    const extras = [
      meta.remedy_hint,
      Array.isArray(meta.reasons) && meta.reasons.length ? `flagged for: ${meta.reasons.join(', ')}` : '',
      meta.limit_source ? `limit: ${meta.limit_source}` : '',
      typeof meta.raw === 'string' ? meta.raw : ''
    ].filter(Boolean)
    return [message, ...extras].filter(Boolean).join(' | ').slice(0, 400)
  } catch {
    return body.trim().slice(0, 200)
  }
}

export function errorFromStatus(status: number, body: string): ProviderError {
  const detail = providerMessage(body)
  const withDetail = (summary: string) => (detail ? `${summary}: ${detail}` : summary)
  if (status === 401) return new ProviderError('auth', withDetail('Invalid or disabled API key (401)'), status)
  if (status === 402) return new ProviderError('other', withDetail('Not enough credits (402)'), status)
  // 403 is not a bad key: OpenRouter uses it for spending limits, guardrails, and moderation.
  if (status === 403) return new ProviderError('other', withDetail('Request refused by the provider (403)'), status)
  if (status === 404) return new ProviderError('other', withDetail('Model or endpoint not found (404)'), status)
  if (status === 429) return new ProviderError('rate_limit', withDetail('Rate limit reached (429)'), status)
  if (status === 400 && /image|vision|multimodal/i.test(body)) {
    return new ProviderError('unsupported', withDetail('This model does not accept images'), status)
  }
  return new ProviderError('other', withDetail(`Provider error ${status}`), status)
}

// Turns a fetch or body-read failure into a ProviderError.
export function fromFetchError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e
  const err = e as { name?: string; message?: string }
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return new ProviderError('timeout', 'Request timed out')
  return new ProviderError('other', String(err?.message ?? e))
}
