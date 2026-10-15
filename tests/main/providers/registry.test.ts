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
    const sleep = vi.fn(async () => {})
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

  it('does not require a key for local endpoints', async () => {
    const complete = vi.fn(async () => 'local ok')
    const reg = createRegistry({ secrets: { get: () => null }, build: () => fakeProvider(complete), sleep: async () => {} })
    reg.configure({ providerId: 'ollama', model: 'llama3', needsKey: false, baseUrl: 'http://localhost:11434/v1' })
    expect(await reg.call({ messages: [] })).toBe('local ok')
  })
})
