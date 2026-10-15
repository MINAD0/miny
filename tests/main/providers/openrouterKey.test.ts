import { describe, expect, it, vi } from 'vitest'
import { describeKeyInfo, fetchOpenRouterKeyInfo } from '../../../src/main/providers/openrouterKey'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

describe('fetchOpenRouterKeyInfo', () => {
  it('reads the limit, usage, and free-model daily quota', async () => {
    const f = vi.fn(async () =>
      json({
        data: {
          label: 'miny',
          limit: 0,
          limit_remaining: 0,
          usage: 0,
          is_free_tier: true,
          free_model_daily_requests: { used: 12, limit: 50, remaining: 38 }
        }
      })
    )
    const info = await fetchOpenRouterKeyInfo('sk-or', f as any)
    expect((f.mock.calls[0] as any)[1].headers.Authorization).toBe('Bearer sk-or')
    expect(info).toMatchObject({ limit: 0, limitRemaining: 0, isFreeTier: true, freeDaily: { used: 12, limit: 50, remaining: 38 } })
    expect(describeKeyInfo(info)).toMatch(/limit is used up, which causes 403/)
    expect(describeKeyInfo(info)).toMatch(/12 of 50 used/)
  })

  it('describes an unlimited key', async () => {
    const info = await fetchOpenRouterKeyInfo('k', (async () => json({ data: { limit: null, usage: 1.5 } })) as any)
    expect(describeKeyInfo(info)).toBe('no spending limit on this key')
  })

  it('reports an invalid key with the provider message', async () => {
    const f = async () => json({ error: { code: 401, message: 'User not found.' } }, 401)
    await expect(fetchOpenRouterKeyInfo('bad', f as any)).rejects.toThrow(/User not found/)
  })
})
