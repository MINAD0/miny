import { describe, expect, it } from 'vitest'
import { toProviderConfig } from '../../../src/main/providers/validate'

describe('toProviderConfig', () => {
  it('takes the base URL from the catalog, ignoring one supplied by the caller', () => {
    const cfg = toProviderConfig({ providerId: 'openai', model: 'gpt-4o', baseUrl: 'https://evil.example' })
    expect(cfg.baseUrl).toBe('https://api.openai.com/v1')
    expect(cfg.needsKey).toBe(true)
  })

  it('rejects unknown providers', () => {
    expect(() => toProviderConfig({ providerId: 'evil', model: 'm' })).toThrow(/unknown provider/i)
  })

  it('rejects empty or oversized model names', () => {
    expect(() => toProviderConfig({ providerId: 'openai', model: '  ' })).toThrow(/model/i)
    expect(() => toProviderConfig({ providerId: 'openai', model: 'x'.repeat(201) })).toThrow(/model/i)
  })

  it('trims the model name', () => {
    expect(toProviderConfig({ providerId: 'ollama', model: ' llama3 ' }).model).toBe('llama3')
  })
})
