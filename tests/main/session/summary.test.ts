import { describe, expect, it, vi } from 'vitest'
import {
  buildSummaryMessages,
  fallbackSummary,
  generateSummary,
  parseSummaryResponse
} from '../../../src/main/session/summary'

const segments = [
  { t_start: 0, t_end: 1, text: 'Welcome to the interview.' },
  { t_start: 1, t_end: 2, text: 'What is a closure?' },
  { t_start: 2, t_end: 3, text: 'I use it for private state.' }
]

describe('summary prompt', () => {
  it('numbers transcript lines and includes session answers', () => {
    const messages = buildSummaryMessages(segments, [{ question: 'What is a closure?', answer: 'A function with its scope.' }])
    const user = messages.find((m) => m.role === 'user')!.content as string
    expect(user).toContain('[1] Welcome to the interview.')
    expect(user).toContain('[2] What is a closure?')
    expect(user).toContain('A function with its scope.')
    expect(String(messages[0].content)).toContain('Return ONLY a JSON object')
  })
})

describe('parseSummaryResponse', () => {
  it('reads plain JSON', () => {
    expect(parseSummaryResponse('{"title":"Closures","content":"## Summary\\nA talk."}')).toEqual({
      title: 'Closures',
      content: '## Summary\nA talk.'
    })
  })

  it('tolerates a fence and surrounding prose', () => {
    const raw = 'Here you go:\n```json\n{"title":"T","content":"body"}\n```'
    expect(parseSummaryResponse(raw)).toEqual({ title: 'T', content: 'body' })
  })

  it('rejects missing or non-string fields and broken JSON', () => {
    expect(parseSummaryResponse('{"title":"T"}')).toBeNull()
    expect(parseSummaryResponse('{"title":1,"content":"x"}')).toBeNull()
    expect(parseSummaryResponse('not json')).toBeNull()
    expect(parseSummaryResponse('')).toBeNull()
  })
})

describe('fallbackSummary', () => {
  it('keeps the full transcript and a dated title', () => {
    const s = fallbackSummary(segments, Date.UTC(2026, 0, 2, 3, 4))
    expect(s.title).toMatch(/^Session /)
    expect(s.content).toContain('What is a closure?')
    expect(s.content.split('\n')).toHaveLength(3)
  })
})

describe('generateSummary', () => {
  it('returns the parsed summary', async () => {
    const call = vi.fn(async () => '{"title":"Interview","content":"## Summary\\nClear answers."}')
    const s = await generateSummary({ call }, segments)
    expect(s).toEqual({ title: 'Interview', content: '## Summary\nClear answers.' })
  })

  it('returns null when the provider fails instead of throwing', async () => {
    const call = vi.fn(async () => {
      throw new Error('offline')
    })
    await expect(generateSummary({ call }, segments)).resolves.toBeNull()
  })

  it('does not call a provider for an empty session', async () => {
    const call = vi.fn(async () => '{}')
    expect(await generateSummary({ call }, [])).toBeNull()
    expect(call).not.toHaveBeenCalled()
  })
})
