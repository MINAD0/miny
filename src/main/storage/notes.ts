import type Database from 'better-sqlite3'

export type Note = {
  id: number
  title: string
  body_md: string
  folder_id: number | null
  favorite: boolean
  archived: boolean
  session_id: number | null
  created_at: number
  updated_at: number
}

export type Folder = { id: number; name: string; parent_id: number | null }

type Row = Omit<Note, 'favorite' | 'archived'> & { favorite: number; archived: number }

const toNote = (r: Row): Note => ({ ...r, favorite: !!r.favorite, archived: !!r.archived })

// Wrap user text as an FTS5 phrase so operators like " or * are treated literally.
const ftsPhrase = (q: string) => '"' + q.replace(/"/g, '""') + '"'

export function createNotesRepo(db: Database.Database) {
  const now = () => Date.now()

  function getNote(id: number): Note | null {
    const r = db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as Row | undefined
    return r ? toNote(r) : null
  }

  return {
    create(input: { title?: string; body_md?: string; folder_id?: number | null; session_id?: number | null }): Note {
      const t = now()
      const info = db
        .prepare(
          `INSERT INTO notes (title, body_md, folder_id, session_id, created_at, updated_at)
           VALUES (@title, @body_md, @folder_id, @session_id, @t, @t)`
        )
        .run({
          title: input.title ?? '',
          body_md: input.body_md ?? '',
          folder_id: input.folder_id ?? null,
          session_id: input.session_id ?? null,
          t
        })
      return getNote(Number(info.lastInsertRowid))!
    },

    update(id: number, patch: Partial<Pick<Note, 'title' | 'body_md' | 'folder_id' | 'favorite' | 'archived'>>): Note {
      const current = getNote(id)
      if (!current) throw new Error(`note ${id} not found`)
      const next = { ...current, ...patch }
      db.prepare(
        `UPDATE notes SET title=@title, body_md=@body_md, folder_id=@folder_id,
           favorite=@favorite, archived=@archived, updated_at=@t WHERE id=@id`
      ).run({
        id,
        title: next.title,
        body_md: next.body_md,
        folder_id: next.folder_id,
        favorite: next.favorite ? 1 : 0,
        archived: next.archived ? 1 : 0,
        t: now()
      })
      return getNote(id)!
    },

    get: getNote,

    list(filter: { folder_id?: number | null; favorite?: boolean; archived?: boolean; tag?: string } = {}): Note[] {
      const where: string[] = []
      const args: Record<string, unknown> = {}
      if (filter.folder_id !== undefined) {
        where.push(filter.folder_id === null ? 'folder_id IS NULL' : 'folder_id = @folder_id')
        if (filter.folder_id !== null) args.folder_id = filter.folder_id
      }
      if (filter.favorite !== undefined) {
        where.push('favorite = @favorite')
        args.favorite = filter.favorite ? 1 : 0
      }
      if (filter.archived !== undefined) {
        where.push('archived = @archived')
        args.archived = filter.archived ? 1 : 0
      }
      if (filter.tag !== undefined) {
        where.push('id IN (SELECT nt.note_id FROM note_tags nt JOIN tags t ON t.id = nt.tag_id WHERE t.name = @tag)')
        args.tag = filter.tag
      }
      const sql = `SELECT * FROM notes ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY updated_at DESC`
      return (db.prepare(sql).all(args) as Row[]).map(toNote)
    },

    search(query: string): Note[] {
      const q = query.trim()
      if (!q) return []
      const rows = db
        .prepare(
          `SELECT n.* FROM notes_fts f JOIN notes n ON n.id = f.rowid
           WHERE notes_fts MATCH ? ORDER BY rank`
        )
        .all(ftsPhrase(q)) as Row[]
      return rows.map(toNote)
    },

    setTags(noteId: number, names: string[]): void {
      const clean = [...new Set(names.map((n) => n.trim()).filter(Boolean))]
      db.transaction(() => {
        db.prepare('DELETE FROM note_tags WHERE note_id = ?').run(noteId)
        for (const name of clean) {
          db.prepare('INSERT OR IGNORE INTO tags (name) VALUES (?)').run(name)
          const tag = db.prepare('SELECT id FROM tags WHERE name = ?').get(name) as { id: number }
          db.prepare('INSERT INTO note_tags (note_id, tag_id) VALUES (?, ?)').run(noteId, tag.id)
        }
      })()
    },

    tagsFor(noteId: number): string[] {
      return (
        db
          .prepare('SELECT t.name FROM tags t JOIN note_tags nt ON nt.tag_id = t.id WHERE nt.note_id = ? ORDER BY t.name')
          .all(noteId) as { name: string }[]
      ).map((r) => r.name)
    },

    createFolder(name: string, parentId: number | null = null): Folder {
      const info = db.prepare('INSERT INTO folders (name, parent_id) VALUES (?, ?)').run(name, parentId)
      return db.prepare('SELECT * FROM folders WHERE id = ?').get(Number(info.lastInsertRowid)) as Folder
    },

    listFolders(): Folder[] {
      return db.prepare('SELECT * FROM folders ORDER BY name').all() as Folder[]
    }
  }
}
