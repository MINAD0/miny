import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDb } from '../../../src/main/storage/db'

const tmpDirs: string[] = []
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

describe('openDb', () => {
  it('creates all tables', () => {
    const db = openDb(':memory:')
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view')").all() as { name: string }[]).map(
      (r) => r.name
    )
    for (const t of ['notes', 'folders', 'tags', 'note_tags', 'sessions', 'segments', 'events', 'settings', 'notes_fts', 'context_docs']) {
      expect(names).toContain(t)
    }
  })

  it('does not re-run migrations when a file is reopened', () => {
    const dir = mkdtempSync(join(tmpdir(), 'miny-db-'))
    tmpDirs.push(dir)
    const file = join(dir, 'test.db')
    openDb(file).close()
    const b = openDb(file)
    expect(b.pragma('user_version', { simple: true })).toBe(2)
    b.close()
  })
})
