export type ModelCaps = { vision: boolean; contextTokens: number }

const TABLE: Record<string, ModelCaps> = {
  'openai:gpt-4o': { vision: true, contextTokens: 128000 },
  'openai:gpt-4o-mini': { vision: true, contextTokens: 128000 },
  'anthropic:claude-sonnet-5-5': { vision: true, contextTokens: 200000 },
  'anthropic:claude-haiku-5-5': { vision: true, contextTokens: 200000 }
}

const DEFAULT: ModelCaps = { vision: false, contextTokens: 8000 }

export function getCaps(providerId: string, model: string): ModelCaps {
  return TABLE[`${providerId}:${model}`] ?? DEFAULT
}
