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
    const { sessionId } = loop.stop('device_lost')
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

  it('ignores chunks that arrive after stop', async () => {
    const transcribe = vi.fn(async () => ({ text: 'late' }))
    const loop = createListenLoop({ transcriber: { transcribe }, onSegment: vi.fn(), onError: vi.fn(), saveSession: () => 1 })
    loop.start()
    loop.stop('user')
    await loop.pushChunk(new Uint8Array([1]), 'audio/webm', 0, 5000)
    expect(transcribe).not.toHaveBeenCalled()
  })
})
