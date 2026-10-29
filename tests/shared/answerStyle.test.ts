import { describe, expect, it } from 'vitest'
import { DEFAULT_ANSWER_STYLE, languageLabel, toAnswerStyle } from '../../src/shared/answerStyle'

describe('answer style', () => {
  it('accepts valid values', () => {
    expect(toAnswerStyle({ length: 'short', vocabulary: 'precise', translateTo: 'fr' })).toEqual({
      length: 'short',
      vocabulary: 'precise',
      translateTo: 'fr'
    })
  })

  it('falls back to defaults for junk', () => {
    expect(toAnswerStyle(null)).toEqual(DEFAULT_ANSWER_STYLE)
    expect(toAnswerStyle({ length: 'huge', vocabulary: 'shakespeare', translateTo: 'xx' })).toEqual(DEFAULT_ANSWER_STYLE)
  })

  it('labels a translation target without its description', () => {
    expect(languageLabel('fr')).toBe('French')
  })
})
