import { describe, expect, it } from 'vitest'
import { openDb } from '../../../src/main/storage/db'
import { createTracker } from '../../../src/main/tracking/events'

describe('tracker', () => {
  it('records nothing before consent is granted', () => {
    const t = createTracker(openDb(':memory:'))
    t.record('session_started', { mode: 'interview' })
    expect(t.activityLog()).toEqual([])
  })

  it('records events after consent and returns them newest first', () => {
    let clock = 1000
    const t = createTracker(openDb(':memory:'), { now: () => clock++ })
    t.setConsent(true)
    t.record('session_started', { mode: 'meeting' })
    t.record('suggestion_requested', { provider: 'openrouter' })
    expect(t.activityLog().map((e) => e.name)).toEqual(['suggestion_requested', 'session_started'])
  })

  it('stops recording when consent is revoked, and wipes history', () => {
    const t = createTracker(openDb(':memory:'))
    t.setConsent(true)
    t.record('a')
    t.revokeAndWipe()
    expect(t.hasConsent()).toBe(false)
    expect(t.activityLog()).toEqual([])
    t.record('b')
    expect(t.activityLog()).toEqual([])
  })

  it('stores only the metadata passed in', () => {
    const t = createTracker(openDb(':memory:'))
    t.setConsent(true)
    t.record('note_saved', { words: 42 })
    expect(JSON.stringify(t.activityLog())).not.toMatch(/body|transcript/)
  })
})
