import { describe, expect, it } from 'vitest'
import { detectQuestions, isQuestion } from '../../../src/main/session/questionDetector'

describe('isQuestion', () => {
  it.each([
    ['What is a closure?', true],
    ['Can you explain your last project', true],
    ['how would you design a cache', true],
    ['Tell me about yourself', true],
    ['I think we should ship it', false],
    ['', false],
    ['   ', false]
  ])('%s -> %s', (text, expected) => {
    expect(isQuestion(text)).toBe(expected)
  })

  it('handles French and Arabic', () => {
    expect(isQuestion('Pouvez-vous me parler de vous ?')).toBe(true)
    expect(isQuestion('مرحبا، كيف حالك؟')).toBe(true)
  })

  it('reads contractions by their first word', () => {
    expect(isQuestion("What's your name")).toBe(true)
    expect(isQuestion("How's the project going")).toBe(true)
  })

  it('does not treat common statements as questions', () => {
    expect(isQuestion('Will do, thanks.')).toBe(false)
    expect(isQuestion('من الشركة جئت')).toBe(false)
  })

  it('does not panic on text with only punctuation', () => {
    expect(() => isQuestion('???')).not.toThrow()
  })
})

describe('detectQuestions', () => {
  it('returns only the question segments in order', () => {
    const segs = [
      { t_start: 0, t_end: 5, text: 'Hello everyone' },
      { t_start: 5, t_end: 10, text: 'What is your biggest weakness?' },
      { t_start: 10, t_end: 15, text: 'I like hiking' }
    ]
    expect(detectQuestions(segs).map((s) => s.t_start)).toEqual([5])
  })
})
