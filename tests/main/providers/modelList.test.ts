import { describe, expect, it, vi } from 'vitest'
import { fetchOpenRouterModels } from '../../../src/main/providers/modelList'
import { getCaps, learnCaps } from '../../../src/main/providers/capabilities'

describe('fetchOpenRouterModels', () => {
  it('parses ids, free flag, vision support, and context length', async () => {
    const f = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              { id: 'z/text:free', name: 'Text', context_length: 32000, architecture: { input_modalities: ['text'] } },
              { id: 'a/vision', name: 'Vision', context_length: 128000, architecture: { input_modalities: ['text', 'image'] } },
              { id: 'b/bare' }
            ]
          }),
          { status: 200 }
        )
    )
    const models = await fetchOpenRouterModels(f as any)
    expect(models.map((m) => m.id)).toEqual(['a/vision', 'b/bare', 'z/text:free'])
    expect(models[0]).toMatchObject({ vision: true, free: false, contextTokens: 128000 })
    expect(models[1]).toMatchObject({ vision: false, free: false, contextTokens: 8000 })
    expect(models[2]).toMatchObject({ vision: false, free: true })
    expect((f.mock.calls[0] as any)[1].signal).toBeInstanceOf(AbortSignal)
  })

  it('reports HTTP failures as provider errors', async () => {
    const f = vi.fn(async () => new Response('down', { status: 503 }))
    await expect(fetchOpenRouterModels(f as any)).rejects.toMatchObject({ kind: 'other' })
  })
})

describe('learned capabilities', () => {
  it('lets a fetched model list turn on vision for that model', () => {
    expect(getCaps('openrouter', 'g/vis:free').vision).toBe(false)
    learnCaps('openrouter', 'g/vis:free', { vision: true, contextTokens: 64000 })
    expect(getCaps('openrouter', 'g/vis:free').vision).toBe(true)
  })
})
