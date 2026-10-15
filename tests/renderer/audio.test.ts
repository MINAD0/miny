import { describe, expect, it } from 'vitest'
import { cleanTranscript, rms } from '../../src/renderer/main/whisper/audio'

describe('cleanTranscript', () => {
  it('keeps real speech', () => {
    expect(cleanTranscript(' What is a closure in JavaScript? ')).toBe('What is a closure in JavaScript?')
    expect(cleanTranscript('Pouvez-vous expliquer votre dernier projet ?')).toBe('Pouvez-vous expliquer votre dernier projet ?')
  })

  it('drops Whisper stock phrases seen on silence or cut-off audio', () => {
    for (const t of ['Thank you for watching!', 'Thanks for watching.', 'you.', 'Merci.', "Sous-titres réalisés para la communauté d'Amara.org"]) {
      expect(cleanTranscript(t)).toBe('')
    }
  })

  it('drops repetition loops (seen in testing with the tiny model)', () => {
    expect(cleanTranscript('Please, please, please, please, please, please, please')).toBe('')
  })

  it('keeps a sentence that only repeats a word a couple of times', () => {
    expect(cleanTranscript('Very very good point')).toBe('Very very good point')
  })

  it('drops non-speech markers', () => {
    expect(cleanTranscript('[BLANK_AUDIO]')).toBe('')
    expect(cleanTranscript('(music)')).toBe('')
    expect(cleanTranscript('♪♪')).toBe('')
  })
})

describe('rms', () => {
  it('is 0 for silence and grows with loudness', () => {
    expect(rms(new Float32Array(100))).toBe(0)
    expect(rms(new Float32Array(100).fill(0.5))).toBeCloseTo(0.5)
  })
})
