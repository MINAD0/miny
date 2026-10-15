import { ChatMessage, ChatRequest, LLMProvider, ProviderError, errorFromStatus } from './types'

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
    id: opts.id,
    async complete(req) {
      const res = await send(req, false)
      const data = (await res.json()) as { choices: { message: { content: string } }[] }
      return data.choices[0].message.content
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
            const payload = line.slice(6).trim()
            if (payload === '[DONE]') return
            const delta = JSON.parse(payload).choices?.[0]?.delta?.content
            if (delta) yield delta as string
          }
        }
      }
    }
  }
}
