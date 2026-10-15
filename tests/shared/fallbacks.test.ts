import { describe, expect, it } from 'vitest'
import { pickFallbacks } from '../../src/shared/fallbacks'

const models = [
  { id: 'google/gemma-4-31b-it:free', free: true, vision: true, contextTokens: 131072 },
  { id: 'google/gemma-4-26b-a4b-it:free', free: true, vision: true, contextTokens: 262144 },
  { id: 'thinkingmachines/inkling:free', free: true, vision: true, contextTokens: 1048576 },
  { id: 'thinkingmachines/inkling-small:free', free: true, vision: true, contextTokens: 1048576 },
  { id: 'nvidia/nemotron-3-super-120b-a12b:free', free: true, vision: false, contextTokens: 262144 },
  { id: 'nvidia/nemotron-3.5-content-safety:free', free: true, vision: true, contextTokens: 9999999 },
  { id: 'openai/gpt-4o', free: false, vision: true, contextTokens: 128000 }
]

describe('pickFallbacks', () => {
  it('picks two free backups from different companies than the main model and each other', () => {
    const picked = pickFallbacks(models, 'google/gemma-4-31b-it:free')
    expect(picked).toEqual(['thinkingmachines/inkling:free', 'nvidia/nemotron-3-super-120b-a12b:free'])
  })

  it('skips safety/guard models and never includes the main model or paid models', () => {
    const picked = pickFallbacks(models, 'thinkingmachines/inkling:free')
    expect(picked).not.toContain('nvidia/nemotron-3.5-content-safety:free')
    expect(picked).not.toContain('thinkingmachines/inkling:free')
    expect(picked).not.toContain('openai/gpt-4o')
  })

  it('fills up from the same company when no other company has free models', () => {
    const onlyGoogle = models.filter((m) => m.id.startsWith('google/'))
    expect(pickFallbacks(onlyGoogle, 'google/gemma-4-31b-it:free')).toEqual(['google/gemma-4-26b-a4b-it:free'])
  })

  it('gives a paid main model no automatic fallbacks', () => {
    expect(pickFallbacks(models, 'openai/gpt-4o')).toEqual([])
  })
})
