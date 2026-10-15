export type ModelCaps = { vision: boolean; contextTokens: number }

const TABLE: Record<string, ModelCaps> = {
  'openai:gpt-4o': { vision: true, contextTokens: 128000 },
  'openai:gpt-4o-mini': { vision: true, contextTokens: 128000 },
  'anthropic:claude-sonnet-5-5': { vision: true, contextTokens: 200000 },
  'anthropic:claude-haiku-5-5': { vision: true, contextTokens: 200000 }
}

// Capabilities learned at runtime from a provider's model list (e.g. OpenRouter).
const learned: Record<string, ModelCaps> = {}

const DEFAULT: ModelCaps = { vision: false, contextTokens: 8000 }

export function learnCaps(providerId: string, model: string, caps: ModelCaps): void {
  learned[`${providerId}:${model}`] = caps
}

export function getCaps(providerId: string, model: string): ModelCaps {
  const key = `${providerId}:${model}`
  return learned[key] ?? TABLE[key] ?? DEFAULT
}
