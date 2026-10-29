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

// Short reactions that only make sense attached to the previous question.
// Whisper transcribes these without a "?" often enough that the openers above
// miss them ("and why", "how so", "et pourquoi").
const FOLLOW_UP =
  /^(and|so|but|then|also|ok(ay)?|right|really|why|how|what about|can you (elaborate|expand)|could you (elaborate|expand)|et|alors|donc|pourquoi|comment|وكيف|ولماذا|وماذا|وهل|وأين|ومتى|و|طيب|لماذا|كيف)(?!\p{L})/iu

export function isFollowUp(text: string): boolean {
  const t = text.trim()
  if (!t || t.length > 120) return false
  if (t.split(/\s+/).length > 12) return false
  return FOLLOW_UP.test(t)
}

export function detectQuestions(segments: Segment[]): Segment[] {
  return segments.filter((s) => isQuestion(s.text))
}
