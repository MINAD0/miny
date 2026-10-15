import { describe, expect, it, vi } from 'vitest'
import { createOpenAITranscriber } from '../../../src/main/transcription/openaiTranscribe'

describe('openai transcriber', () => {
  it('posts multipart audio and returns text', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ text: ' hello there ' }), { status: 200 }))
    const t = createOpenAITranscriber({ apiKey: 'k', model: 'test-model', fetch: f as any })
    const out = await t.transcribe({ bytes: new Uint8Array([1, 2, 3]), mime: 'audio/webm' })
    expect(out.text).toBe('hello there')
    const [url, init] = f.mock.calls[0] as any
    expect(url).toBe('https://api.openai.com/v1/audio/transcriptions')
    expect(init.body).toBeInstanceOf(FormData)
    expect((init.body as FormData).get('model')).toBe('test-model')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('maps a stuck upload to a timeout error', async () => {
    const f = vi.fn(async () => {
      throw Object.assign(new Error('timed out'), { name: 'TimeoutError' })
    })
    const t = createOpenAITranscriber({ apiKey: 'k', model: 'm', fetch: f as any })
    await expect(t.transcribe({ bytes: new Uint8Array([1]), mime: 'audio/webm' })).rejects.toMatchObject({ kind: 'timeout' })
  })

  it('returns empty text for silent chunks instead of throwing', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ text: '   ' }), { status: 200 }))
    const t = createOpenAITranscriber({ apiKey: 'k', model: 'm', fetch: f as any })
    expect((await t.transcribe({ bytes: new Uint8Array([0]), mime: 'audio/webm' })).text).toBe('')
  })
})
