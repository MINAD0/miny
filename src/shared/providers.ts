// The providers miny can talk to. The main process only accepts provider settings
// that match this list, so a stored API key can never be sent to an arbitrary host.
export type ProviderEntry = {
  id: string
  label: string
  baseUrl: string
  needsKey: boolean
  defaultModel: string
}

export const PROVIDERS: ProviderEntry[] = [
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', needsKey: true, defaultModel: 'gpt-4o-mini' },
  { id: 'anthropic', label: 'Anthropic (Claude)', baseUrl: 'https://api.anthropic.com', needsKey: true, defaultModel: 'claude-haiku-5-5' },
  {
    id: 'openrouter',
    label: 'OpenRouter (includes free models)',
    baseUrl: 'https://openrouter.ai/api/v1',
    needsKey: true,
    // Free models change often; Settings loads the live list. This one existed on 2026-10-15.
    defaultModel: 'google/gemma-4-31b-it:free'
  },
  { id: 'ollama', label: 'Ollama (local)', baseUrl: 'http://localhost:11434/v1', needsKey: false, defaultModel: 'llama3' }
]

export function findProvider(id: unknown): ProviderEntry | undefined {
  return PROVIDERS.find((p) => p.id === id)
}
