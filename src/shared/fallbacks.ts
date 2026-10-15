export type ModelSummary = { id: string; free: boolean; vision: boolean; contextTokens: number }

const MAX_FALLBACKS = 2

// Special-purpose models that don't answer general questions.
const NOT_GENERAL = /(safety|guard|moderation|embed|rerank)/i

// For a free main model, picks other free models to try when it is busy
// (free models share an upstream pool that is often rate-limited).
// A paid main model gets no automatic fallbacks, so answers never silently change model class.
export function pickFallbacks(models: ModelSummary[], primary: string): string[] {
  if (!primary.endsWith(':free')) return []
  return models
    .filter((m) => m.free && m.id !== primary && !NOT_GENERAL.test(m.id))
    .sort((a, b) => b.contextTokens - a.contextTokens) // bigger context as a rough proxy for bigger models
    .slice(0, MAX_FALLBACKS)
    .map((m) => m.id)
}
