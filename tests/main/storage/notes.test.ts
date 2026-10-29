import { beforeEach, describe, expect, it } from 'vitest'
import { openDb } from '../../../src/main/storage/db'
import { createNotesRepo } from '../../../src/main/storage/notes'

describe('notes repo', () => {
  let repo: ReturnType<typeof createNotesRepo>

  beforeEach(() => {
    repo = createNotesRepo(openDb(':memory:'))
  })

  it('creates and reads a note with defaults', () => {
    const n = repo.create({ title: 'Standup' })
    const got = repo.get(n.id)!
    expect(got.title).toBe('Standup')
    expect(got.body_md).toBe('')
    expect(got.favorite).toBe(false)
    expect(got.archived).toBe(false)
  })

  it('updates fields and bumps updated_at', async () => {
    const n = repo.create({ title: 'a' })
    await new Promise((r) => setTimeout(r, 5))
    const u = repo.update(n.id, { title: 'b', favorite: true })
    expect(u.title).toBe('b')
    expect(u.favorite).toBe(true)
    expect(u.updated_at).toBeGreaterThanOrEqual(n.updated_at)
  })

  it('searches title and body with FTS', () => {
    repo.create({ title: 'Kubernetes question', body_md: 'pods and nodes' })
    repo.create({ title: 'Lunch', body_md: 'pizza' })
    expect(repo.search('kubernetes').map((h) => h.title)).toEqual(['Kubernetes question'])
    expect(repo.search('pizza').length).toBe(1)
  })

  it('finds notes after their body is edited', () => {
    const n = repo.create({ title: 'x', body_md: 'old words' })
    repo.update(n.id, { body_md: 'fresh words' })
    expect(repo.search('fresh').length).toBe(1)
    expect(repo.search('old').length).toBe(0)
  })

  it('stores titles with emoji and unicode intact', () => {
    const n = repo.create({ title: 'مقابلة 🚀 café' })
    expect(repo.get(n.id)!.title).toBe('مقابلة 🚀 café')
    expect(repo.search('café').length).toBe(1)
  })

  it('treats a search containing FTS operators as plain text', () => {
    repo.create({ title: 'a "quoted" thing', body_md: '' })
    expect(() => repo.search('"unbalanced')).not.toThrow()
    expect(() => repo.search('NEAR(*')).not.toThrow()
  })

  it('filters by folder and tag', () => {
    const f = repo.createFolder('Interviews')
    const a = repo.create({ title: 'A', folder_id: f.id })
    const b = repo.create({ title: 'B' })
    repo.setTags(a.id, ['sql'])
    repo.setTags(b.id, ['sql'])
    expect(repo.list({ folder_id: f.id }).map((n) => n.id)).toEqual([a.id])
    expect(repo.list({ tag: 'sql' }).length).toBe(2)
  })

  it('filters favorites and archived notes', () => {
    const a = repo.create({ title: 'A' })
    repo.create({ title: 'B' })
    repo.update(a.id, { favorite: true, archived: true })
    expect(repo.list({ favorite: true }).map((n) => n.id)).toEqual([a.id])
    expect(repo.list({ archived: false }).length).toBe(1)
  })

  it('lists folders alphabetically', () => {
    repo.createFolder('Zeta')
    repo.createFolder('Alpha')
    expect(repo.listFolders().map((f) => f.name)).toEqual(['Alpha', 'Zeta'])
  })

  it('replaces tags and ignores blank or duplicate names', () => {
    const n = repo.create({ title: 'T' })
    repo.setTags(n.id, ['a', ' a ', '', 'b'])
    expect(repo.tagsFor(n.id)).toEqual(['a', 'b'])
    repo.setTags(n.id, ['c'])
    expect(repo.tagsFor(n.id)).toEqual(['c'])
  })

  it('round-trips the raw transcript and session Q&A', () => {
    const n = repo.create({
      title: 'Session',
      body_md: 'summary',
      transcript: 'line one\nline two',
      qa: [{ question: 'Why?', answer: 'Because.' }]
    })
    const got = repo.get(n.id)!
    expect(got.transcript).toBe('line one\nline two')
    expect(got.qa).toEqual([{ question: 'Why?', answer: 'Because.' }])
    expect(repo.list({ archived: false })[0].qa).toHaveLength(1)
  })
})
