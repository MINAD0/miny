import { describe, expect, it } from 'vitest'
import { pickFallbacks } from '../../src/shared/fallbacks'

const models = [
  { id: 'google/gemma-4-31b-it:free', free: true, vision: true, contextTokens: 131072 },
  { id: 'nvidia/nemotron-3-super-120b-a12b:free', free: true, vision: false, contextTokens: 262144 },
  { id: 'nvidia/nemotron-3.5-content-safety:free', free: true, vision: true, contextTokens: 999999 },
  { id: 'thinkingmachines/inkling:free', free: true, vision: true, contextTokens: 65536 },
  { id: 'liquid/lfm-2.5-2.6b:free', free: true, vision: false, contextTokens: 32768 },
  { id: 'openai/gpt-4o', free: false, vision: true, contextTokens: 128000 }
]

describe('pickFallbacks', () => {
  it('picks up to two other general free models for a free main model', () => {
    expect(pickFallbacks(models, 'google/gemma-4-31b-it:free')).toEqual([
      'nvidia/nemotron-3-super-120b-a12b:free',
      'thinkingmachines/inkling:free'
    ])
  })

  it('skips safety/guard models and never includes the main model or paid models', () => {
    const picked = pickFallbacks(models, 'thinkingmachines/inkling:free')
    expect(picked).not.toContain('nvidia/nemotron-3.5-content-safety:free')
    expect(picked).not.toContain('thinkingmachines/inkling:free')
    expect(picked).not.toContain('openai/gpt-4o')
  })

  it('gives a paid main model no automatic fallbacks', () => {
    expect(pickFallbacks(models, 'openai/gpt-4o')).toEqual([])
  })
})
