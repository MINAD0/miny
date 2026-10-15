// Transcription settings shared by Settings and the main process.
export type SttProvider = 'local' | 'openai'
export type SttConfig = { provider: SttProvider; localModel: 'tiny' | 'base' | 'small'; language: string }

export const LOCAL_MODELS = [
  { id: 'base', label: 'Base: balanced (recommended)' },
  { id: 'small', label: 'Small: most accurate, needs a fast PC' },
  { id: 'tiny', label: 'Tiny: fastest, often wrong outside clear English' }
] as const

// There is no "detect automatically": in testing, local Whisper given no language
// output English even for French speech (it translated instead of transcribing).
export const LANGUAGES = [
  { id: 'en', label: 'English' },
  { id: 'fr', label: 'French' },
  { id: 'ar', label: 'Arabic' },
  { id: 'es', label: 'Spanish' },
  { id: 'de', label: 'German' }
] as const

// Picks the transcription language from the system locale (e.g. "fr-FR" -> "fr").
export function languageForLocale(locale: string | undefined): string {
  const code = (locale ?? '').slice(0, 2).toLowerCase()
  return LANGUAGES.some((l) => l.id === code) ? code : 'en'
}

// Local Whisper is the default: no key needed, and audio stays on the machine.
export function defaultStt(locale?: string): SttConfig {
  return { provider: 'local', localModel: 'base', language: languageForLocale(locale) }
}

// Accepts untrusted input and falls back to defaults for anything unrecognized.
export function toSttConfig(input: unknown, locale?: string): SttConfig {
  const d = defaultStt(locale)
  const v = (input ?? {}) as Partial<Record<keyof SttConfig, unknown>>
  const provider = v.provider === 'openai' ? 'openai' : 'local'
  const localModel = LOCAL_MODELS.some((m) => m.id === v.localModel) ? (v.localModel as SttConfig['localModel']) : d.localModel
  const language = LANGUAGES.some((l) => l.id === v.language) ? (v.language as string) : d.language
  return { provider, localModel, language }
}
