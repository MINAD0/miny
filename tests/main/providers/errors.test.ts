import { describe, expect, it } from 'vitest'
import { errorFromStatus, providerMessage } from '../../../src/main/providers/types'

describe('errorFromStatus', () => {
  it('shows OpenRouter’s reason and fix hint for a 403 budget block', () => {
    const body = JSON.stringify({
      error: {
        code: 403,
        message: 'Key limit exceeded',
        metadata: { limit_source: 'key', remedy_hint: 'Raise the key limit at openrouter.ai/settings/keys' }
      }
    })
    const e = errorFromStatus(403, body)
    expect(e.kind).toBe('other') // a 403 is not a bad key
    expect(e.message).toContain('Request refused by the provider (403)')
    expect(e.message).toContain('Key limit exceeded')
    expect(e.message).toContain('Raise the key limit')
    expect(e.message).toContain('limit: key')
  })

  it('shows moderation reasons', () => {
    const body = JSON.stringify({ error: { code: 403, message: 'Input flagged', metadata: { reasons: ['harassment'] } } })
    expect(errorFromStatus(403, body).message).toContain('flagged for: harassment')
  })

  it('keeps 401 as an auth error with the provider message', () => {
    const e = errorFromStatus(401, JSON.stringify({ error: { message: 'No auth credentials found' } }))
    expect(e.kind).toBe('auth')
    expect(e.message).toContain('No auth credentials found')
  })

  it('names 402 and 404 plainly', () => {
    expect(errorFromStatus(402, '{"error":{"message":"Insufficient credits"}}').message).toMatch(/Not enough credits.*Insufficient credits/)
    expect(errorFromStatus(404, '{"error":{"message":"No endpoints found"}}').message).toMatch(/not found.*No endpoints found/)
  })

  it('falls back to raw text for non-JSON bodies', () => {
    expect(providerMessage('Service down')).toBe('Service down')
  })
})
