import { LANGUAGES } from './transcription'

// How answers should read. smog exposes the same three dials (length, vocabulary,
// translation); miny keeps them local settings instead of server-side account flags.
export type AnswerLength = 'short' | 'normal' | 'detailed'
export type AnswerVocabulary = 'simple' | 'natural' | 'precise'
export type AnswerStyle = { length: AnswerLength; vocabulary: AnswerVocabulary; translateTo: string }

export const DEFAULT_ANSWER_STYLE: AnswerStyle = { length: 'normal', vocabulary: 'natural', translateTo: '' }

export const LENGTH_OPTIONS: { id: AnswerLength; label: string }[] = [
  { id: 'short', label: 'Short: 1-2 sentences' },
  { id: 'normal', label: 'Normal: concise but complete' },
  { id: 'detailed', label: 'Detailed: add an example or the why' }
]

export const VOCABULARY_OPTIONS: { id: AnswerVocabulary; label: string }[] = [
  { id: 'simple', label: 'Simple: everyday words (A2)' },
  { id: 'natural', label: 'Natural: professional (B2)' },
  { id: 'precise', label: 'Precise: technical (C1)' }
]

// Empty id means "do not translate".
export const TRANSLATION_TARGETS: { id: string; label: string }[] = [
  { id: '', label: 'Off: answer in the conversation language' },
  ...LANGUAGES.map((l) => ({ id: l.id, label: l.label }))
]

// Settings are stored in SQLite and can be edited by hand, so validate on read.
export function toAnswerStyle(input: unknown): AnswerStyle {
  const v = (input ?? {}) as Partial<Record<keyof AnswerStyle, unknown>>
  const length = LENGTH_OPTIONS.some((o) => o.id === v.length) ? (v.length as AnswerLength) : DEFAULT_ANSWER_STYLE.length
  const vocabulary = VOCABULARY_OPTIONS.some((o) => o.id === v.vocabulary)
    ? (v.vocabulary as AnswerVocabulary)
    : DEFAULT_ANSWER_STYLE.vocabulary
  const translateTo = TRANSLATION_TARGETS.some((o) => o.id === v.translateTo) ? (v.translateTo as string) : ''
  return { length, vocabulary, translateTo }
}

export function languageLabel(id: string): string {
  return TRANSLATION_TARGETS.find((t) => t.id === id)?.label.split(':')[0] ?? id
}
