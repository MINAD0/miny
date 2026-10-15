import { describe, expect, it, vi } from 'vitest'
import { createRegistry } from '../../../src/main/providers/registry'
import { ProviderError } from '../../../src/main/providers/types'

const fakeProvider = (complete: any, stream: any = async function* () {}) => ({ id: 'fake', complete, stream })
const config = { providerId: 'openai', model: 'gpt-4o', needsKey: true, baseUrl: 'https://x' }

describe('registry', () => {
  it('rejects an empty API key without calling the network', async () => {
    const complete = vi.fn()
    const reg = createRegistry({ secrets: { get: () => '   ' }, build: () => fakeProvider(complete), sleep: async () => {} })
    reg.configure(config)
    await expect(reg.call({ messages: [] })).rejects.toMatchObject({ kind: 'auth' })
    expect(complete).not.toHaveBeenCalled()
  })

  it('retries rate limits at most 3 times, then gives up', async () => {
    const complete = vi.fn(async () => {
      throw new ProviderError('rate_limit', 'slow')
    })
    const sleep = vi.fn(async (_ms: number) => {})
    const reg = createRegistry({ secrets: { get: () => 'k' }, build: () => fakeProvider(complete), sleep })
    reg.configure(config)
    await expect(reg.call({ messages: [] })).rejects.toMatchObject({ kind: 'rate_limit' })
    expect(complete).toHaveBeenCalledTimes(4) // 1 try + 3 retries
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([500, 1000, 2000])
  })

  it('never retries auth errors', async () => {
    const complete = vi.fn(async () => {
      throw new ProviderError('auth', 'bad')
    })
    const reg = createRegistry({ secrets: { get: () => 'k' }, build: () => fakeProvider(complete), sleep: async () => {} })
    reg.configure(config)
    await expect(reg.call({ messages: [] })).rejects.toMatchObject({ kind: 'auth' })
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('blocks calls while the kill switch is on', async () => {
    const complete = vi.fn(async () => 'x')
    const reg = createRegistry({ secrets: { get: () => 'k' }, build: () => fakeProvider(complete), sleep: async () => {} })
    reg.configure(config)
    reg.setKillSwitch(true)
    await expect(reg.call({ messages: [] })).rejects.toThrow(/kill switch/i)
    expect(complete).not.toHaveBeenCalled()
  })

  it('blocks streams while the kill switch is on, before any request', () => {
    const stream = vi.fn()
    const reg = createRegistry({ secrets: { get: () => 'k' }, build: () => fakeProvider(vi.fn(), stream), sleep: async () => {} })
    reg.configure(config)
    reg.setKillSwitch(true)
    expect(() => reg.stream({ messages: [] })).toThrow(/kill switch/i)
    expect(stream).not.toHaveBeenCalled()
  })

  it('retries a stream that is rate limited before its first token', async () => {
    let calls = 0
    const stream = vi.fn(async function* () {
      calls++
      if (calls < 3) throw new ProviderError('rate_limit', 'slow')
      yield 'ok'
    })
    const sleep = vi.fn(async (_ms: number) => {})
    const reg = createRegistry({ secrets: { get: () => 'k' }, build: () => fakeProvider(vi.fn(), stream), sleep })
    reg.configure(config)
    let out = ''
    for await (const t of reg.stream({ messages: [] })) out += t
    expect(out).toBe('ok')
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([500, 1000])
  })

  it('does not retry a stream that fails after text was shown', async () => {
    const stream = vi.fn(async function* () {
      yield 'part'
      throw new ProviderError('rate_limit', 'slow')
    })
    const reg = createRegistry({ secrets: { get: () => 'k' }, build: () => fakeProvider(vi.fn(), stream), sleep: async () => {} })
    reg.configure(config)
    const got: string[] = []
    await expect(
      (async () => {
        for await (const t of reg.stream({ messages: [] })) got.push(t)
      })()
    ).rejects.toMatchObject({ kind: 'rate_limit' })
    expect(got).toEqual(['part'])
    expect(stream).toHaveBeenCalledTimes(1)
  })

  it('moves to a fallback model when the main one is rate-limited (busy free model)', async () => {
    const tried: string[] = []
    const stream = vi.fn(async function* (req: any) {
      tried.push(req.model)
      if (req.model === 'busy:free') throw new ProviderError('rate_limit', 'temporarily rate-limited upstream', 429)
      yield `answer from ${req.model}`
    })
    const reg = createRegistry({ secrets: { get: () => 'k' }, build: () => fakeProvider(vi.fn(), stream), sleep: async () => {} })
    reg.configure({ ...config, model: 'busy:free', fallbackModels: ['other:free', 'third:free'] })
    let out = ''
    for await (const t of reg.stream({ messages: [] })) out += t
    expect(out).toBe('answer from other:free')
    expect(tried).toEqual(['busy:free', 'busy:free', 'other:free']) // one short retry, then fallback
    expect(reg.lastModelUsed()).toBe('other:free')
  })

  it('call() falls back too, and reports the last error if every model fails', async () => {
    const complete = vi.fn(async () => {
      throw new ProviderError('rate_limit', 'busy', 429)
    })
    const reg = createRegistry({ secrets: { get: () => 'k' }, build: () => fakeProvider(complete), sleep: async () => {} })
    reg.configure({ ...config, model: 'a', fallbackModels: ['b'] })
    await expect(reg.call({ messages: [] })).rejects.toThrow('busy')
    expect(complete.mock.calls.map((c: any) => c[0].model)).toEqual(['a', 'a', 'b', 'b'])
  })

  it('does not try other models on an auth error', async () => {
    const complete = vi.fn(async () => {
      throw new ProviderError('auth', 'bad key', 401)
    })
    const reg = createRegistry({ secrets: { get: () => 'k' }, build: () => fakeProvider(complete), sleep: async () => {} })
    reg.configure({ ...config, model: 'a', fallbackModels: ['b'] })
    await expect(reg.call({ messages: [] })).rejects.toMatchObject({ kind: 'auth' })
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('only falls back to image-capable models for a screenshot question', async () => {
    const tried: string[] = []
    const complete = vi.fn(async (req: any) => {
      tried.push(req.model)
      if (req.model === 'main') throw new ProviderError('other', 'down', 503)
      return 'ok'
    })
    const reg = createRegistry({
      secrets: { get: () => 'k' },
      build: () => fakeProvider(complete),
      sleep: async () => {},
      supportsVision: (_p, m) => m === 'sees'
    })
    reg.configure({ ...config, model: 'main', fallbackModels: ['blind', 'sees'] })
    await reg.call({ messages: [{ role: 'user', content: [{ type: 'image', mime: 'image/png', base64: 'A' }] }] })
    expect(tried).toEqual(['main', 'sees'])
  })

  it('does not require a key for local endpoints', async () => {
    const complete = vi.fn(async () => 'local ok')
    const reg = createRegistry({ secrets: { get: () => null }, build: () => fakeProvider(complete), sleep: async () => {} })
    reg.configure({ providerId: 'ollama', model: 'llama3', needsKey: false, baseUrl: 'http://localhost:11434/v1' })
    expect(await reg.call({ messages: [] })).toBe('local ok')
  })
})
