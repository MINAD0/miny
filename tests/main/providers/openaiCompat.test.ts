import { describe, expect, it, vi } from 'vitest'
import { createOpenAICompatProvider } from '../../../src/main/providers/openaiCompat'
import { ProviderError } from '../../../src/main/providers/types'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('openai-compatible provider', () => {
  it('posts to /chat/completions with bearer auth and returns the content', async () => {
    const f = vi.fn(async () => json({ choices: [{ message: { content: 'hi' } }] }))
    const p = createOpenAICompatProvider({ id: 'openrouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k', fetch: f as any })
    expect(await p.complete({ model: 'm', messages: [{ role: 'user', content: 'yo' }] })).toBe('hi')
    const [url, init] = f.mock.calls[0] as any
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(init.headers.Authorization).toBe('Bearer k')
  })

  it('sends images as data URLs for vision models', async () => {
    const f = vi.fn(async () => json({ choices: [{ message: { content: 'ok' } }] }))
    const p = createOpenAICompatProvider({ id: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'k', fetch: f as any })
    await p.complete({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'what is this' },
            { type: 'image', mime: 'image/png', base64: 'AAA' }
          ]
        }
      ]
    })
    const body = JSON.parse((f.mock.calls[0] as any)[1].body)
    expect(body.messages[0].content[1]).toEqual({ type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } })
  })

  it('omits the Authorization header for local endpoints without a key', async () => {
    const f = vi.fn(async () => json({ choices: [{ message: { content: 'x' } }] }))
    const p = createOpenAICompatProvider({ id: 'ollama', baseUrl: 'http://localhost:11434/v1', apiKey: null, fetch: f as any })
    await p.complete({ model: 'llama3', messages: [{ role: 'user', content: 'x' }] })
    expect((f.mock.calls[0] as any)[1].headers.Authorization).toBeUndefined()
  })

  it('maps 401 to an auth error', async () => {
    const f = vi.fn(async () => new Response('nope', { status: 401 }))
    const p = createOpenAICompatProvider({ id: 'openai', baseUrl: 'https://x', apiKey: 'bad', fetch: f as any })
    await expect(p.complete({ model: 'm', messages: [] })).rejects.toMatchObject({ kind: 'auth' })
  })

  it('maps 429 to a rate_limit ProviderError', async () => {
    const f = vi.fn(async () => new Response('slow down', { status: 429 }))
    const p = createOpenAICompatProvider({ id: 'openai', baseUrl: 'https://x', apiKey: 'k', fetch: f as any })
    await expect(p.complete({ model: 'm', messages: [] })).rejects.toBeInstanceOf(ProviderError)
    await expect(p.complete({ model: 'm', messages: [] })).rejects.toMatchObject({ kind: 'rate_limit' })
  })

  it('streams CRLF-framed responses (common from local servers)', async () => {
    const sse = 'data: {"choices":[{"delta":{"content":"he"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"y"}}]}\r\n\r\ndata: [DONE]\r\n\r\n'
    const f = vi.fn(async () => new Response(sse, { status: 200 }))
    const p = createOpenAICompatProvider({ id: 'ollama', baseUrl: 'https://x', apiKey: null, fetch: f as any })
    let out = ''
    for await (const chunk of p.stream({ model: 'm', messages: [] })) out += chunk
    expect(out).toBe('hey')
  })

  it('raises an error sent mid-stream instead of ending quietly', async () => {
    const sse = 'data: {"choices":[{"delta":{"content":"par"}}]}\n\ndata: {"error":{"code":502,"message":"upstream died"}}\n\n'
    const f = vi.fn(async () => new Response(sse, { status: 200 }))
    const p = createOpenAICompatProvider({ id: 'openrouter', baseUrl: 'https://x', apiKey: 'k', fetch: f as any })
    const got: string[] = []
    await expect(
      (async () => {
        for await (const c of p.stream({ model: 'm', messages: [] })) got.push(c)
      })()
    ).rejects.toThrow(/upstream died/)
    expect(got).toEqual(['par'])
  })

  it('maps a timeout to the timeout kind', async () => {
    const f = vi.fn(async () => {
      throw Object.assign(new Error('timed out'), { name: 'TimeoutError' })
    })
    const p = createOpenAICompatProvider({ id: 'openai', baseUrl: 'https://x', apiKey: 'k', fetch: f as any })
    await expect(p.complete({ model: 'm', messages: [] })).rejects.toMatchObject({ kind: 'timeout' })
  })

  it('always sends a timeout signal', async () => {
    const f = vi.fn(async () => json({ choices: [{ message: { content: 'x' } }] }))
    const p = createOpenAICompatProvider({ id: 'openai', baseUrl: 'https://x', apiKey: 'k', fetch: f as any })
    await p.complete({ model: 'm', messages: [] })
    expect((f.mock.calls[0] as any)[1].signal).toBeInstanceOf(AbortSignal)
  })

  it('streams SSE deltas', async () => {
    const sse =
      'data: {"choices":[{"delta":{"content":"he"}}]}\n\ndata: {"choices":[{"delta":{"content":"llo"}}]}\n\ndata: [DONE]\n\n'
    const f = vi.fn(async () => new Response(sse, { status: 200 }))
    const p = createOpenAICompatProvider({ id: 'openai', baseUrl: 'https://x', apiKey: 'k', fetch: f as any })
    let out = ''
    for await (const chunk of p.stream({ model: 'm', messages: [] })) out += chunk
    expect(out).toBe('hello')
  })
})
