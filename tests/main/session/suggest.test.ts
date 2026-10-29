import { describe, expect, it, vi } from 'vitest'
import { createSuggester } from '../../../src/main/session/suggest'

async function* tokens(...parts: string[]) {
  for (const p of parts) yield p
}

describe('suggester', () => {
  it('streams tokens and returns the full answer', async () => {
    const chat = { stream: vi.fn(() => tokens('Use ', 'a map.')) }
    const s = createSuggester({ chat })
    const seen: string[] = []
    const full = await s.suggest('How do you store keys?', [{ t_start: 0, t_end: 5, text: 'context' }], (t) => seen.push(t))
    expect(seen).toEqual(['Use ', 'a map.'])
    expect(full).toBe('Use a map.')
  })

  it('includes only the last N segments in the prompt', async () => {
    const chat = { stream: vi.fn(() => tokens('ok')) }
    const s = createSuggester({ chat, contextSegments: 2 })
    const recent = [
      { t_start: 0, t_end: 1, text: 'first' },
      { t_start: 1, t_end: 2, text: 'second' },
      { t_start: 2, t_end: 3, text: 'third' }
    ]
    await s.suggest('q?', recent, () => {})
    const userText = JSON.stringify((chat.stream.mock.calls[0] as any)[0].messages)
    expect(userText).not.toContain('first')
    expect(userText).toContain('second')
    expect(userText).toContain('third')
  })

  it('ask works with no transcript context', async () => {
    const chat = { stream: vi.fn(() => tokens('answer')) }
    const s = createSuggester({ chat })
    expect(await s.ask('define idempotent', null, () => {})).toBe('answer')
  })

  it('adds the resume and context documents to the prompt', async () => {
    const chat = { stream: vi.fn(() => tokens('ok')) }
    const s = createSuggester({
      chat,
      context: () => ({
        resume: 'Ten years of backend work',
        documents: [{ name: 'Role', text: 'TypeScript and Postgres' }]
      })
    })
    await s.suggest('Tell me about yourself', [], () => {})
    const userText = JSON.stringify((chat.stream.mock.calls[0] as any)[0].messages)
    expect(userText).toContain('Ten years of backend work')
    expect(userText).toContain('TypeScript and Postgres')
    expect(userText).toContain('Role')
  })

  it('applies length, vocabulary, and translation settings', async () => {
    const chat = { stream: vi.fn(() => tokens('ok')) }
    const s = createSuggester({
      chat,
      style: () => ({ length: 'short', vocabulary: 'simple', translateTo: 'fr' })
    })
    await s.ask('q', null, () => {})
    const system = (chat.stream.mock.calls[0] as any)[0].messages[0].content as string
    expect(system).toContain('1 to 2 sentences')
    expect(system).toContain('CEFR A2')
    expect(system).toContain('Translation mode is enabled with target language: French')
  })
})
