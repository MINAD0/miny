import { beforeEach, describe, expect, it } from 'vitest'
import { openDb } from '../../../src/main/storage/db'
import { createContextStore } from '../../../src/main/context/store'

describe('context store', () => {
  let store: ReturnType<typeof createContextStore>

  beforeEach(() => {
    store = createContextStore(openDb(':memory:'))
  })

  it('stores one resume and replaces it on save', () => {
    const first = store.saveResume('resume.txt', 'First job: support engineer')
    expect(first.kind).toBe('resume')
    const second = store.saveResume('cv.txt', 'Second job: backend engineer')
    expect(second.name).toBe('cv.txt')
    expect(store.list().filter((d) => d.kind === 'resume')).toHaveLength(1)
    expect(store.getResume()!.text).toContain('backend')
  })

  it('adds and removes context documents without touching the resume', () => {
    store.saveResume('resume', 'my background')
    const doc = store.addDocument('Job description', 'We need TypeScript')
    expect(store.list().filter((d) => d.kind === 'document')).toHaveLength(1)
    store.removeDocument(doc.id)
    expect(store.getResume()!.text).toBe('my background')
    expect(store.list().filter((d) => d.kind === 'document')).toHaveLength(0)
  })

  it('rejects empty documents and code-point limits are applied', () => {
    expect(() => store.saveResume('x', '   ')).toThrow()
    expect(() => store.addDocument('x', '')).toThrow()
    const doc = store.addDocument('big', 'a'.repeat(300_000))
    expect(doc.text.length).toBeLessThanOrEqual(200_000)
  })

  it('builds a capped prompt context', () => {
    store.saveResume('resume', 'r'.repeat(20_000))
    for (let i = 0; i < 5; i++) store.addDocument(`doc ${i}`, 'd'.repeat(9_000))
    const ctx = store.promptContext()
    expect(ctx.resume.length).toBe(12_000)
    expect(ctx.documents.length).toBeGreaterThan(0)
    expect(ctx.documents.reduce((n, d) => n + d.text.length, 0)).toBeLessThanOrEqual(24_000)
  })
})
