import type { Segment } from './listen'

// Words that open a question even when the transcript has no "?".
// Left out on purpose: "will" ("Will do.") and Arabic "من" (also means "from");
// real questions starting with these usually get a "?" from transcription.
const OPENERS = [
  'what', 'why', 'how', 'when', 'where', 'who', 'which', 'can', 'could', 'would',
  'do', 'does', 'did', 'is', 'are', 'tell', 'explain', 'describe', 'walk', 'give',
  'pouvez', 'pourriez', 'quel', 'quelle', 'comment', 'pourquoi',
  'كيف', 'ماذا', 'لماذا', 'هل', 'أين', 'متى'
]

export function isQuestion(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (/[?؟]\s*$/.test(t)) return true
  // First run of letters, so "what's" reads as "what".
  const first = t.toLowerCase().match(/\p{L}+/u)?.[0] ?? ''
  return OPENERS.includes(first)
}

export function detectQuestions(segments: Segment[]): Segment[] {
  return segments.filter((s) => isQuestion(s.text))
}
