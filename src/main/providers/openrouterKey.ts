import { errorFromStatus, fromFetchError } from './types'

export type OpenRouterKeyInfo = {
  label: string | null
  limit: number | null // null = no limit on this key
  limitRemaining: number | null
  usage: number
  isFreeTier: boolean
  freeDaily: { used: number; limit: number; remaining: number } | null
}

// GET /api/v1/key reports the key's spending limit and today's free-model quota,
// which explains most 403 (limit reached) and 429 (free quota used) errors.
export async function fetchOpenRouterKeyInfo(apiKey: string, f: typeof fetch = fetch): Promise<OpenRouterKeyInfo> {
  let res: Response
  try {
    res = await f('https://openrouter.ai/api/v1/key', {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000)
    })
  } catch (e) {
    throw fromFetchError(e)
  }
  if (!res.ok) throw errorFromStatus(res.status, await res.text())
  const d = ((await res.json()) as { data?: any }).data ?? {}
  const daily = d.free_model_daily_requests
  return {
    label: typeof d.label === 'string' ? d.label : null,
    limit: typeof d.limit === 'number' ? d.limit : null,
    limitRemaining: typeof d.limit_remaining === 'number' ? d.limit_remaining : null,
    usage: typeof d.usage === 'number' ? d.usage : 0,
    isFreeTier: d.is_free_tier === true,
    freeDaily:
      daily && typeof daily.limit === 'number'
        ? { used: Number(daily.used) || 0, limit: daily.limit, remaining: Number(daily.remaining) || 0 }
        : null
  }
}

// One-line summary for Settings.
export function describeKeyInfo(k: OpenRouterKeyInfo): string {
  const parts: string[] = []
  if (k.limit === null) parts.push('no spending limit on this key')
  else parts.push(`spending limit $${k.limit.toFixed(2)}, $${(k.limitRemaining ?? 0).toFixed(2)} left`)
  if (k.limit !== null && (k.limitRemaining ?? 0) <= 0) parts.push('the limit is used up, which causes 403 errors')
  if (k.freeDaily) parts.push(`free-model requests today: ${k.freeDaily.used} of ${k.freeDaily.limit} used`)
  if (k.freeDaily && k.freeDaily.remaining <= 0) parts.push('the daily free quota is used up')
  return parts.join('; ')
}
