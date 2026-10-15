import { describe, expect, it, vi } from 'vitest'
import { createAnthropicProvider } from '../../../src/main/providers/anthropic'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('anthropic provider', () => {
  it('uses x-api-key and anthropic-version headers and pulls the system message out', async () => {
    const f = vi.fn(async () => json({ content: [{ type: 'text', text: 'answer' }] }))
    const p = createAnthropicProvider({ apiKey: 'sk-ant', fetch: f as any })
    const out = await p.complete({
      model: 'claude-sonnet-5-5',
      messages: [
        { role: 'system', content: 'be brief' },
        { role: 'user', content: 'q?' }
      ]
    })
    expect(out).toBe('answer')
    const [url, init] = f.mock.calls[0] as any
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(init.headers['x-api-key']).toBe('sk-ant')
    expect(init.headers['anthropic-version']).toBe('2023-06-01')
    const body = JSON.parse(init.body)
    expect(body.system).toBe('be brief')
    expect(body.messages).toEqual([{ role: 'user', content: 'q?' }])
  })

  it('converts image parts to Anthropic image blocks', async () => {
    const f = vi.fn(async () => json({ content: [{ type: 'text', text: 'ok' }] }))
    const p = createAnthropicProvider({ apiKey: 'k', fetch: f as any })
    await p.complete({
      model: 'claude-sonnet-5-5',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', mime: 'image/png', base64: 'AAA' },
            { type: 'text', text: 'read' }
          ]
        }
      ]
    })
    const body = JSON.parse((f.mock.calls[0] as any)[1].body)
    expect(body.messages[0].content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'AAA' }
    })
  })

  it('maps 401 to auth', async () => {
    const f = vi.fn(async () => new Response('bad key', { status: 401 }))
    const p = createAnthropicProvider({ apiKey: 'x', fetch: f as any })
    await expect(p.complete({ model: 'm', messages: [] })).rejects.toMatchObject({ kind: 'auth' })
  })
})
