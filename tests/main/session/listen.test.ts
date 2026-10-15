import { describe, expect, it, vi } from 'vitest'
import { createListenLoop } from '../../../src/main/session/listen'

describe('listen loop', () => {
  it('transcribes each chunk and emits segments in order', async () => {
    const transcriber = { transcribe: vi.fn(async () => ({ text: 'hi' })) }
    const onSegment = vi.fn((_seg: any) => {})
    const loop = createListenLoop({ transcriber, onSegment, onError: vi.fn(), saveSession: () => 1 })
    loop.start()
    await loop.pushChunk(new Uint8Array([1]), 'audio/webm', 0, 5000)
    await loop.pushChunk(new Uint8Array([2]), 'audio/webm', 5000, 10000)
    expect(onSegment.mock.calls.map((c) => c[0].text)).toEqual(['hi', 'hi'])
    expect(onSegment.mock.calls[1][0].t_start).toBe(5000)
  })

  it('skips empty transcriptions', async () => {
    const onSegment = vi.fn((_seg: any) => {})
    const loop = createListenLoop({
      transcriber: { transcribe: async () => ({ text: '' }) },
      onSegment,
      onError: vi.fn(),
      saveSession: () => 1
    })
    loop.start()
    await loop.pushChunk(new Uint8Array([1]), 'audio/webm', 0, 5000)
    expect(onSegment).not.toHaveBeenCalled()
  })

  it('keeps the partial transcript when the device is lost', async () => {
    const saveSession = vi.fn((_segs: any[]) => 42)
    const loop = createListenLoop({
      transcriber: { transcribe: async () => ({ text: 'partial words' }) },
      onSegment: vi.fn(),
      onError: vi.fn(),
      saveSession
    })
    loop.start()
    await loop.pushChunk(new Uint8Array([1]), 'audio/webm', 0, 5000)
    const { sessionId } = await loop.stop('device_lost')
    expect(sessionId).toBe(42)
    expect(saveSession.mock.calls[0][0].map((s: any) => s.text)).toEqual(['partial words'])
  })

  it('reports a failed chunk and keeps listening', async () => {
    const onError = vi.fn()
    const transcribe = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ text: 'ok' })
    const onSegment = vi.fn((_seg: any) => {})
    const loop = createListenLoop({ transcriber: { transcribe }, onSegment, onError, saveSession: () => 1 })
    loop.start()
    await loop.pushChunk(new Uint8Array([1]), 'audio/webm', 0, 5000)
    await loop.pushChunk(new Uint8Array([2]), 'audio/webm', 5000, 10000)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onSegment.mock.calls.map((c) => c[0].text)).toEqual(['ok'])
  })

  it('waits for a chunk still being transcribed before saving the session', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const transcribe = vi.fn(async () => {
      await gate
      return { text: 'last question?' }
    })
    const saveSession = vi.fn((_segs: any[]) => 7)
    const loop = createListenLoop({ transcriber: { transcribe }, onSegment: vi.fn(), onError: vi.fn(), saveSession })
    loop.start()
    void loop.pushChunk(new Uint8Array([1]), 'audio/webm', 0, 5000)
    const stopping = loop.stop('user')
    release()
    await stopping
    expect(saveSession.mock.calls[0][0].map((s: any) => s.text)).toEqual(['last question?'])
  })

  it('keeps two sessions separate when the user restarts during a slow stop', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const texts = ['A', 'B', 'C']
    let i = 0
    const transcribe = vi.fn(async () => {
      const t = texts[i++]
      if (t === 'B') await gate
      return { text: t }
    })
    const saved: string[][] = []
    const loop = createListenLoop({
      transcriber: { transcribe },
      onSegment: vi.fn(),
      onError: vi.fn(),
      saveSession: (segs) => {
        saved.push(segs.map((s) => s.text))
        return saved.length
      }
    })
    loop.start()
    await loop.pushChunk(new Uint8Array([1]), 'audio/webm', 0, 5000) // A done
    void loop.pushChunk(new Uint8Array([2]), 'audio/webm', 5000, 10000) // B in flight
    const firstStop = loop.stop('user')
    loop.start() // restart before the first stop finishes
    await loop.pushChunk(new Uint8Array([3]), 'audio/webm', 0, 5000) // C, new session
    release()
    await firstStop
    await loop.stop('user')
    expect(saved).toEqual([['A', 'B'], ['C']])
  })

  it('saves once even if stop is called twice', async () => {
    const saveSession = vi.fn((_segs: any[]) => 1)
    const loop = createListenLoop({ transcriber: { transcribe: async () => ({ text: 'x' }) }, onSegment: vi.fn(), onError: vi.fn(), saveSession })
    loop.start()
    await loop.pushChunk(new Uint8Array([1]), 'audio/webm', 0, 5000)
    await Promise.all([loop.stop('user'), loop.stop('device_lost')])
    expect(saveSession).toHaveBeenCalledTimes(1)
  })

  it('does not save an empty session', async () => {
    const saveSession = vi.fn((_segs: any[]) => 1)
    const loop = createListenLoop({ transcriber: { transcribe: async () => ({ text: '' }) }, onSegment: vi.fn(), onError: vi.fn(), saveSession })
    loop.start()
    await loop.pushChunk(new Uint8Array([1]), 'audio/webm', 0, 5000)
    expect((await loop.stop('user')).sessionId).toBeNull()
    expect(saveSession).not.toHaveBeenCalled()
  })

  it('ignores chunks that arrive after stop', async () => {
    const transcribe = vi.fn(async () => ({ text: 'late' }))
    const loop = createListenLoop({ transcriber: { transcribe }, onSegment: vi.fn(), onError: vi.fn(), saveSession: () => 1 })
    loop.start()
    await loop.stop('user')
    await loop.pushChunk(new Uint8Array([1]), 'audio/webm', 0, 5000)
    expect(transcribe).not.toHaveBeenCalled()
  })
})
