import { findProvider } from '../../shared/providers'
import type { ProviderConfig } from './registry'

// Builds a provider config from untrusted renderer input. The base URL and key
// requirement always come from the catalog, never from the caller.
export function toProviderConfig(input: unknown): ProviderConfig {
  const v = (input ?? {}) as { providerId?: unknown; model?: unknown }
  const entry = findProvider(v.providerId)
  if (!entry) throw new Error('Unknown provider')
  const model = typeof v.model === 'string' ? v.model.trim() : ''
  if (!model || model.length > 200) throw new Error('Enter a model name')
  return { providerId: entry.id, model, needsKey: entry.needsKey, baseUrl: entry.baseUrl }
}
