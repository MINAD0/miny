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

  return {
    start() {
      active = true
      segments.length = 0
    },
    async pushChunk(bytes: Uint8Array, mime: string, startMs: number, endMs: number): Promise<void> {
      if (!active) return
      try {
        const { text } = await deps.transcriber.transcribe({ bytes, mime })
        if (!text) return
        const seg = { t_start: startMs, t_end: endMs, text }
        segments.push(seg)
        deps.onSegment(seg)
      } catch (e) {
        deps.onError(e)
      }
    },
    stop(_reason: 'user' | 'device_lost'): { sessionId: number } {
      active = false
      return { sessionId: deps.saveSession([...segments]) }
    }
  }
}
