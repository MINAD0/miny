export type ModelSummary = { id: string; free: boolean; vision: boolean; contextTokens: number }

const MAX_FALLBACKS = 2

// Special-purpose models that don't answer general questions.
const NOT_GENERAL = /(safety|guard|moderation|embed|rerank)/i

// "google/gemma-4-31b-it:free" -> "google"
const orgOf = (id: string) => id.split('/')[0]

// For a free main model, picks other free models to try when it is busy
// (free models share an upstream pool that is often rate-limited).
// Backups come from different companies than the main model and each other, since one
// company's free capacity tends to be busy all at once.
// A paid main model gets no automatic fallbacks, so answers never silently change model class.
export function pickFallbacks(models: ModelSummary[], primary: string): string[] {
  if (!primary.endsWith(':free')) return []
  const candidates = models
    .filter((m) => m.free && m.id !== primary && !NOT_GENERAL.test(m.id))
    .sort((a, b) => b.contextTokens - a.contextTokens) // bigger context as a rough proxy for bigger models

  const picked: string[] = []
  const usedOrgs = new Set([orgOf(primary)])
  for (const m of candidates) {
    if (picked.length >= MAX_FALLBACKS) break
    if (usedOrgs.has(orgOf(m.id))) continue
    picked.push(m.id)
    usedOrgs.add(orgOf(m.id))
  }
  // If there aren't enough other companies, fill up with the best remaining models.
  for (const m of candidates) {
    if (picked.length >= MAX_FALLBACKS) break
    if (!picked.includes(m.id)) picked.push(m.id)
  }
  return picked
}
