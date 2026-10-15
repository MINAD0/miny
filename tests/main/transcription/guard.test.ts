import { describe, expect, it, vi } from 'vitest'
import { guardTranscriber } from '../../../src/main/transcription/guard'
import { createListenLoop } from '../../../src/main/session/listen'

describe('guardTranscriber', () => {
  it('does not send audio while the kill switch is on', async () => {
    const inner = { transcribe: vi.fn(async () => ({ text: 'x' })) }
    const t = guardTranscriber(inner, () => true)
    await expect(t.transcribe({ bytes: new Uint8Array([1]), mime: 'audio/webm' })).rejects.toThrow(/kill switch/i)
    expect(inner.transcribe).not.toHaveBeenCalled()
  })

  it('stops sending mid-session as soon as the switch flips', async () => {
    let killed = false
    const inner = { transcribe: vi.fn(async () => ({ text: 'words' })) }
    const onError = vi.fn()
    const loop = createListenLoop({
      transcriber: guardTranscriber(inner, () => killed),
      onSegment: vi.fn(),
      onError,
      saveSession: () => 1
    })
    loop.start()
    await loop.pushChunk(new Uint8Array([1]), 'audio/webm', 0, 5000)
    killed = true
    await loop.pushChunk(new Uint8Array([2]), 'audio/webm', 5000, 10000)
    expect(inner.transcribe).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledTimes(1)
  })
})
