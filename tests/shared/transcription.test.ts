import { describe, expect, it } from 'vitest'
import { defaultStt, languageForLocale, toSttConfig } from '../../src/shared/transcription'

describe('transcription settings', () => {
  it('defaults to local Whisper base, in the system language', () => {
    expect(defaultStt('fr-FR')).toEqual({ provider: 'local', localModel: 'base', language: 'fr' })
    expect(defaultStt('en-US').language).toBe('en')
  })

  it('falls back to English for unsupported locales', () => {
    expect(languageForLocale('ja-JP')).toBe('en')
    expect(languageForLocale(undefined)).toBe('en')
  })

  it('keeps valid choices', () => {
    expect(toSttConfig({ provider: 'openai', localModel: 'small', language: 'ar' }, 'en-US')).toEqual({
      provider: 'openai',
      localModel: 'small',
      language: 'ar'
    })
  })

  it('replaces unknown values with defaults, including an old "auto" (null) language', () => {
    expect(toSttConfig({ provider: 'evil', localModel: 'huge', language: null }, 'fr-MA')).toEqual(defaultStt('fr-MA'))
  })
})
