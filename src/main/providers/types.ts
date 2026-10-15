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

export function errorFromStatus(status: number, body: string): ProviderError {
  if (status === 401 || status === 403) return new ProviderError('auth', `Authentication failed (${status})`, status)
  if (status === 429) return new ProviderError('rate_limit', 'Rate limit reached', status)
  if (status === 400 && /image|vision|multimodal/i.test(body)) {
    return new ProviderError('unsupported', 'This model does not accept images', status)
  }
  return new ProviderError('other', `Provider error ${status}: ${body.slice(0, 200)}`, status)
}

// Turns a fetch or body-read failure into a ProviderError.
export function fromFetchError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e
  const err = e as { name?: string; message?: string }
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return new ProviderError('timeout', 'Request timed out')
  return new ProviderError('other', String(err?.message ?? e))
}
