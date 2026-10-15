import { errorFromStatus, ProviderError } from '../providers/types'
import type { Transcriber } from './types'

type Opts = { apiKey: string; model: string; baseUrl?: string; fetch?: typeof fetch }

export function createOpenAITranscriber(opts: Opts): Transcriber {
  const f = opts.fetch ?? fetch
  const url = (opts.baseUrl ?? 'https://api.openai.com/v1') + '/audio/transcriptions'

  return {
    async transcribe(audio, o) {
      const form = new FormData()
      form.append('file', new Blob([audio.bytes], { type: audio.mime }), 'chunk.webm')
      form.append('model', opts.model)
      if (o?.language) form.append('language', o.language)

      let res: Response
      try {
        res = await f(url, { method: 'POST', headers: { Authorization: `Bearer ${opts.apiKey}` }, body: form })
      } catch (e: any) {
        throw new ProviderError('other', String(e?.message ?? e))
      }
      if (!res.ok) throw errorFromStatus(res.status, await res.text())
      const data = (await res.json()) as { text: string }
      return { text: data.text.trim() }
    }
  }
}
