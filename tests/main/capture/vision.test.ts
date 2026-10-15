import { describe, expect, it } from 'vitest'
import { buildVisionMessage, checkVision } from '../../../src/main/capture/vision'

describe('vision', () => {
  it('blocks vision for a model without image support, with a reason', () => {
    const r = checkVision('openrouter', 'some-free-text-model')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/does not support images/i)
  })

  it('allows vision for a known vision model', () => {
    expect(checkVision('openai', 'gpt-4o')).toEqual({ ok: true })
  })

  it('builds a multimodal user message with the image first', () => {
    const m = buildVisionMessage('what is on screen?', 'AAA')
    expect(m.role).toBe('user')
    expect(m.content).toEqual([
      { type: 'image', mime: 'image/png', base64: 'AAA' },
      { type: 'text', text: 'what is on screen?' }
    ])
  })
})
