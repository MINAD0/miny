import type { Segment } from './listen'

const OPENERS = [
  'what', 'why', 'how', 'when', 'where', 'who', 'which', 'can', 'could', 'would', 'will',
  'do', 'does', 'did', 'is', 'are', 'tell', 'explain', 'describe', 'walk', 'give',
  'pouvez', 'pourriez', 'quel', 'quelle', 'comment', 'pourquoi',
  'كيف', 'ماذا', 'لماذا', 'هل', 'من', 'أين', 'متى'
]

export function isQuestion(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  if (/[?؟]\s*$/.test(t)) return true
  const first = t.toLowerCase().split(/\s+/)[0].replace(/[^\p{L}]/gu, '')
  return OPENERS.includes(first)
}

export function detectQuestions(segments: Segment[]): Segment[] {
  return segments.filter((s) => isQuestion(s.text))
}
