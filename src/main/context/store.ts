import type Database from 'better-sqlite3'
import type { ContextDocument, PromptContext } from '../../shared/context'

export type ContextKind = 'resume' | 'document'

export type ContextDoc = {
  id: number
  kind: ContextKind
  name: string
  text: string
  created_at: number
  updated_at: number
}

// Input limits. They keep a pasted document from turning every answer request
// into a token bill, and they match the caps applied when building the prompt.
const MAX_INPUT_CHARS = 200_000
const MAX_RESUME_PROMPT_CHARS = 12_000
const MAX_DOC_PROMPT_CHARS = 8_000
const MAX_CONTEXT_PROMPT_CHARS = 24_000

const normalize = (value: unknown): string => String(value ?? '').replace(/\r\n/g, '\n').trim().slice(0, MAX_INPUT_CHARS)

export function createContextStore(db: Database.Database) {
  const now = () => Date.now()

  const list = (): ContextDoc[] =>
    db.prepare("SELECT * FROM context_docs ORDER BY kind = 'resume' DESC, updated_at DESC").all() as ContextDoc[]

  const get = (id: number): ContextDoc | null => (db.prepare('SELECT * FROM context_docs WHERE id = ?').get(id) as ContextDoc | undefined) ?? null

  const getResume = (): ContextDoc | null =>
    (db.prepare("SELECT * FROM context_docs WHERE kind = 'resume' ORDER BY updated_at DESC LIMIT 1").get() as ContextDoc | undefined) ?? null

  return {
    list,
    get,
    getResume,

    // One resume replaces the previous one. Stored as a row so the UI can show
    // its file name and update time, like smog's resume.db table.
    saveResume(name: unknown, text: unknown): ContextDoc {
      const t = normalize(text)
      if (!t) throw new Error('The resume is empty')
      const label = normalize(name) || 'resume'
      db.transaction(() => {
        db.prepare("DELETE FROM context_docs WHERE kind = 'resume'").run()
        db.prepare(
          "INSERT INTO context_docs (kind, name, text, created_at, updated_at) VALUES ('resume', ?, ?, ?, ?)"
        ).run(label.slice(0, 200), t, now(), now())
      })()
      return getResume()!
    },

    addDocument(name: unknown, text: unknown): ContextDoc {
      const t = normalize(text)
      if (!t) throw new Error('The document is empty')
      const label = normalize(name) || `Document ${list().filter((d) => d.kind === 'document').length + 1}`
      const info = db
        .prepare("INSERT INTO context_docs (kind, name, text, created_at, updated_at) VALUES ('document', ?, ?, ?, ?)")
        .run(label.slice(0, 200), t, now(), now())
      return get(Number(info.lastInsertRowid))!
    },

    removeDocument(id: number): void {
      // The resume is replaced through saveResume, never removed by id.
      db.prepare("DELETE FROM context_docs WHERE id = ? AND kind = 'document'").run(id)
    },

    // Prompt-ready context, capped independently of what is stored.
    promptContext(): PromptContext {
      const resume = getResume()
      const documents: ContextDocument[] = []
      let budget = MAX_CONTEXT_PROMPT_CHARS
      for (const doc of list().filter((d) => d.kind === 'document')) {
        if (budget <= 0) break
        const text = doc.text.slice(0, Math.min(MAX_DOC_PROMPT_CHARS, budget))
        if (!text) continue
        documents.push({ name: doc.name, text })
        budget -= text.length
      }
      return { resume: resume?.text.slice(0, MAX_RESUME_PROMPT_CHARS) ?? '', documents }
    }
  }
}
