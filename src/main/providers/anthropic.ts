import { ChatMessage, ChatRequest, ContentPart, LLMProvider, ProviderError, errorFromStatus } from './types'

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
        signal: req.signal
      })
    } catch (e: any) {
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError') throw new ProviderError('timeout', 'Request timed out')
      throw new ProviderError('other', String(e?.message ?? e))
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
      const reader = res.body!.getReader()
      const dec = new TextDecoder()
      let buf = ''
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        let idx: number
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const event = buf.slice(0, idx)
          buf = buf.slice(idx + 2)
          for (const line of event.split('\n')) {
            if (!line.startsWith('data: ')) continue
            const evt = JSON.parse(line.slice(6))
            if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') yield evt.delta.text as string
          }
        }
      }
    }
  }
}
