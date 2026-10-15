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
})
