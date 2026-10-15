import type { Transcriber } from '../transcription/types'

export type Segment = { t_start: number; t_end: number; text: string }

type Deps = {
  transcriber: Transcriber
  onSegment(seg: Segment): void
  onError(err: unknown): void
  saveSession(segments: Segment[]): number
}

export function createListenLoop(deps: Deps) {
  let active = false
  const segments: Segment[] = []
  const pending = new Set<Promise<void>>()

  async function transcribeChunk(bytes: Uint8Array, mime: string, startMs: number, endMs: number): Promise<void> {
    try {
      const { text } = await deps.transcriber.transcribe({ bytes, mime })
      if (!text) return
      const seg = { t_start: startMs, t_end: endMs, text }
      segments.push(seg)
      deps.onSegment(seg)
    } catch (e) {
      deps.onError(e)
    }
  }

  return {
    start() {
      active = true
      segments.length = 0
    },
    pushChunk(bytes: Uint8Array, mime: string, startMs: number, endMs: number): Promise<void> {
      if (!active) return Promise.resolve()
      const p = transcribeChunk(bytes, mime, startMs, endMs)
      pending.add(p)
      return p.finally(() => pending.delete(p))
    },
    // Waits for chunks still being transcribed, so the end of the session is not lost.
    async stop(_reason: 'user' | 'device_lost'): Promise<{ sessionId: number }> {
      active = false
      await Promise.allSettled([...pending])
      segments.sort((a, b) => a.t_start - b.t_start)
      return { sessionId: deps.saveSession([...segments]) }
    }
  }
}
