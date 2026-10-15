import type { Segment } from './listen'

// Words that open a question even when the transcript has no "?" (Whisper often drops it).
// Left out on purpose: "will" ("Will do.") and Arabic "من" (also means "from");
// real questions starting with these usually get a "?" from transcription.
const OPENERS = [
  // English
  'what', 'why', 'how', 'when', 'where', 'who', 'which', 'can', 'could', 'would',
  'do', 'does', 'did', 'is', 'are', 'tell', 'explain', 'describe', 'walk', 'give',
  // French ("qu" covers qu'est-ce que; "est" covers est-ce que)
  'pouvez', 'pourriez', 'peux', 'pourrais', 'quel', 'quelle', 'quels', 'quelles', 'comment', 'pourquoi',
  'combien', 'quand', 'où', 'qu', 'est', 'avez', 'êtes', 'parlez', 'expliquez', 'décrivez', 'racontez',
  // Arabic
  'كيف', 'ماذا', 'لماذا', 'هل', 'أين', 'متى'
]

function isQuestionSentence(sentence: string): boolean {
  const t = sentence.trim()
  if (!t) return false
  if (/[?؟]\s*$/.test(t)) return true
  // First run of letters, so "what's" reads as "what" and "Pouvez-vous" as "pouvez".
  const first = t.toLowerCase().match(/\p{L}+/u)?.[0] ?? ''
  return OPENERS.includes(first)
}

// A chunk often holds several sentences ("Bonjour. Pouvez-vous expliquer…"), so each one is checked.
export function isQuestion(text: string): boolean {
  return text.split(/(?<=[.!?؟])\s+/).some(isQuestionSentence)
}

export function detectQuestions(segments: Segment[]): Segment[] {
  return segments.filter((s) => isQuestion(s.text))
}
