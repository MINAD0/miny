import { errorFromStatus, fromFetchError } from '../providers/types'
import type { Transcriber } from './types'

type Opts = { apiKey: string; model: string; baseUrl?: string; fetch?: typeof fetch }

// A stuck upload must not block the session from stopping and saving.
const TRANSCRIBE_TIMEOUT_MS = 30_000

export function createOpenAITranscriber(opts: Opts): Transcriber {
  const f = opts.fetch ?? fetch
  const url = (opts.baseUrl ?? 'https://api.openai.com/v1') + '/audio/transcriptions'

  return {
    async transcribe(audio, o) {
      const form = new FormData()
      form.append('file', new Blob([new Uint8Array(audio.bytes)], { type: audio.mime }), 'chunk.webm')
      form.append('model', opts.model)
      if (o?.language) form.append('language', o.language)

      let res: Response
      try {
        res = await f(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${opts.apiKey}` },
          body: form,
          signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS)
        })
      } catch (e) {
        throw fromFetchError(e)
      }
      if (!res.ok) throw errorFromStatus(res.status, await res.text())
      const data = (await res.json()) as { text: string }
      return { text: data.text.trim() }
    }
  }
}
