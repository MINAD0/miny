import { describe, expect, it } from 'vitest'
import { detectQuestions, isFollowUp, isQuestion } from '../../../src/main/session/questionDetector'

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

  it('finds a question that follows a greeting in the same chunk', () => {
    expect(isQuestion('Bonjour. Pouvez-vous expliquer votre dernier projet')).toBe(true)
    expect(isQuestion('Hello everyone. What is a closure in JavaScript')).toBe(true)
  })

  it('detects French questions without a question mark (as Whisper often outputs them)', () => {
    for (const q of [
      "Qu'est-ce qu'une closure",
      'Est-ce que vous avez déjà utilisé React',
      'Avez-vous travaillé en équipe',
      'Combien de temps a duré le projet',
      'Parlez-moi de vous'
    ]) {
      expect(isQuestion(q)).toBe(true)
    }
  })

  it('does not flag plain greetings or statements', () => {
    expect(isQuestion('Bonjour. Merci de votre présence.')).toBe(false)
    expect(isQuestion('Hello everyone. Thanks for joining.')).toBe(false)
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

describe('isFollowUp', () => {
  it('recognises short continuations of the previous question', () => {
    for (const text of ['and why', 'How so?', 'what about caching', 'Could you elaborate', 'et pourquoi', 'then what', 'وكيف', 'طيب لماذا']) {
      expect(isFollowUp(text)).toBe(true)
    }
  })

  it('does not match a longer word that merely starts the same way', () => {
    expect(isFollowUp('android development')).toBe(false)
    expect(isFollowUp('software design')).toBe(false)
  })

  it('ignores standalone statements, long text, and empty input', () => {
    expect(isFollowUp('Thanks, that makes sense.')).toBe(false)
    expect(isFollowUp('')).toBe(false)
    expect(isFollowUp('and ' + 'word '.repeat(20))).toBe(false)
  })
})
