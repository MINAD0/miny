import { fromFetchError, errorFromStatus } from './types'

export type ModelInfo = { id: string; name: string; free: boolean; vision: boolean; contextTokens: number }

const LIST_TIMEOUT_MS = 15_000

// OpenRouter's model list is public (no key needed) and changes often, so it is
// fetched live rather than hardcoded. Free models end in ":free".
export async function fetchOpenRouterModels(f: typeof fetch = fetch): Promise<ModelInfo[]> {
  let res: Response
  try {
    res = await f('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(LIST_TIMEOUT_MS) })
  } catch (e) {
    throw fromFetchError(e)
  }
  if (!res.ok) throw errorFromStatus(res.status, await res.text())
  const body = (await res.json()) as {
    data?: { id: string; name?: string; context_length?: number; architecture?: { input_modalities?: string[] } }[]
  }
  return (body.data ?? [])
    .filter((m) => typeof m.id === 'string')
    .map((m) => ({
      id: m.id,
      name: m.name ?? m.id,
      free: m.id.endsWith(':free'),
      vision: (m.architecture?.input_modalities ?? []).includes('image'),
      contextTokens: m.context_length ?? 8000
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
}
