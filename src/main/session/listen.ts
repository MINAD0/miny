import type { Transcriber } from '../transcription/types'

export type Segment = { t_start: number; t_end: number; text: string }

type Deps = {
  transcriber: Transcriber
  onSegment(seg: Segment): void
  onError(err: unknown): void
  saveSession(segments: Segment[]): number
}

// Each start() gets its own session, so a slow stop of one session can't mix
// its segments with, or wipe, the next one.
type Session = { segments: Segment[]; pending: Set<Promise<void>> }

export function createListenLoop(deps: Deps) {
  let current: Session | null = null

  async function transcribeChunk(s: Session, bytes: Uint8Array, mime: string, startMs: number, endMs: number): Promise<void> {
    try {
      const { text } = await deps.transcriber.transcribe({ bytes, mime })
      if (!text) return
      const seg = { t_start: startMs, t_end: endMs, text }
      s.segments.push(seg)
      // Live updates only for the running session; a stopping session just collects its tail.
      if (s === current) deps.onSegment(seg)
    } catch (e) {
      deps.onError(e)
    }
  }

  return {
    start() {
      current = { segments: [], pending: new Set() }
    },
    isActive(): boolean {
      return current !== null
    },
    pushChunk(bytes: Uint8Array, mime: string, startMs: number, endMs: number): Promise<void> {
      const s = current
      if (!s) return Promise.resolve()
      const p = transcribeChunk(s, bytes, mime, startMs, endMs)
      s.pending.add(p)
      return p.finally(() => s.pending.delete(p))
    },
    // Waits for chunks still being transcribed, so the end of the session is not lost.
    // Returns null when there was no running session or nothing was said.
    async stop(_reason: 'user' | 'device_lost'): Promise<{ sessionId: number | null }> {
      const s = current
      current = null
      if (!s) return { sessionId: null }
      await Promise.allSettled([...s.pending])
      if (!s.segments.length) return { sessionId: null }
      s.segments.sort((a, b) => a.t_start - b.t_start)
      return { sessionId: deps.saveSession([...s.segments]) }
    }
  }
}
