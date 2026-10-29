import { useEffect, useRef, useState } from 'react'
import { cleanIpcError } from './ipcError'

type Qa = { question: string; answer: string }

type Note = {
  id: number
  title: string
  body_md: string
  folder_id: number | null
  favorite: boolean
  archived: boolean
  session_id: number | null
  transcript: string
  qa: Qa[]
  updated_at: number
}
type Folder = { id: number; name: string; parent_id: number | null }
type Filter = { kind: 'all' } | { kind: 'favorites' } | { kind: 'archived' } | { kind: 'folder'; id: number }
type Draft = { id: number; title: string; body_md: string }

const SAVE_DELAY_MS = 400

export function NotesView() {
  const [notes, setNotes] = useState<Note[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [filter, setFilter] = useState<Filter>({ kind: 'all' })
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Note | null>(null)
  // Title and body are edited locally and saved after typing pauses, so keystrokes
  // never wait on a round trip to the main process.
  const [draft, setDraft] = useState<Draft | null>(null)
  const dirty = useRef(false)
  const [tags, setTags] = useState('')
  const [newFolder, setNewFolder] = useState('')
  const [error, setError] = useState('')
  const [summarizing, setSummarizing] = useState(false)
  const [summaryStatus, setSummaryStatus] = useState('')
  const openId = useRef<number | null>(null)

  const refresh = async () => {
    setFolders(await window.miny.folders.list())
    if (query.trim()) {
      setNotes(await window.miny.notes.search(query))
      return
    }
    const f =
      filter.kind === 'favorites'
        ? { favorite: true, archived: false }
        : filter.kind === 'archived'
          ? { archived: true }
          : filter.kind === 'folder'
            ? { folder_id: filter.id, archived: false }
            : { archived: false }
    setNotes(await window.miny.notes.list(f))
  }

  useEffect(() => {
    void refresh()
  }, [query, filter])

  // A background summary updates the note after the session is saved. Reload
  // both the list and the open note so the new title and body appear at once.
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh
  useEffect(
    () =>
      window.miny.notes.onChanged(async ({ id }) => {
        await refreshRef.current()
        if (openId.current !== id) return
        const n = await window.miny.notes.get(id)
        if (!n) return
        setSelected(n)
        // The user may be typing while a background summary arrives. Their draft
        // wins; it is flushed normally and will overwrite the generated body.
        if (dirty.current) return
        setDraft({ id: n.id, title: n.title, body_md: n.body_md })
      }),
    []
  )

  const flushDraft = async () => {
    if (!draft || !dirty.current) return
    dirty.current = false
    try {
      const updated = await window.miny.notes.update(draft.id, { title: draft.title, body_md: draft.body_md })
      setSelected((s) => (s && s.id === updated.id ? updated : s))
      void refresh()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  useEffect(() => {
    if (!draft || !dirty.current) return
    const t = setTimeout(() => void flushDraft(), SAVE_DELAY_MS)
    return () => clearTimeout(t)
  }, [draft])

  const editDraft = (patch: Partial<Omit<Draft, 'id'>>) => {
    if (!draft) return
    dirty.current = true
    setDraft({ ...draft, ...patch })
  }

  const [exported, setExported] = useState('')

  const open = async (n: Note) => {
    await flushDraft()
    openId.current = n.id
    setSelected(n)
    setDraft({ id: n.id, title: n.title, body_md: n.body_md })
    dirty.current = false
    setExported('')
    setTags('')
    const t = await window.miny.notes.tags(n.id)
    // Ignore a late reply if the user has already switched to another note.
    if (openId.current === n.id) setTags(t.join(', '))
  }

  // Checkbox and folder changes are single clicks, so they save immediately.
  const saveMeta = async (patch: Partial<Pick<Note, 'favorite' | 'archived' | 'folder_id'>>) => {
    if (!selected) return
    const before = selected
    setSelected({ ...selected, ...patch }) // show the change at once; revert if the save fails
    try {
      const updated = await window.miny.notes.update(selected.id, patch)
      setSelected((s) => (s && s.id === updated.id ? updated : s))
      setError('')
      void refresh()
    } catch (e) {
      setSelected((s) => (s && s.id === before.id ? before : s))
      setError((e as Error).message)
    }
  }

  const saveTags = async () => {
    if (!selected) return
    await window.miny.notes.setTags(selected.id, tags.split(',').map((t) => t.trim()))
  }

  const summarize = async () => {
    if (!selected) return
    await flushDraft()
    setSummarizing(true)
    setSummaryStatus('Writing a summary from the transcript…')
    try {
      const n = (await window.miny.notes.summarize(selected.id)) as Note
      setSelected(n)
      setDraft({ id: n.id, title: n.title, body_md: n.body_md })
      dirty.current = false
      setSummaryStatus('Summary regenerated.')
      await refresh()
    } catch (e) {
      setSummaryStatus(cleanIpcError(e))
    } finally {
      setSummarizing(false)
    }
  }

  const createNote = async () => {
    const n = await window.miny.notes.create({
      title: 'Untitled',
      folder_id: filter.kind === 'folder' ? filter.id : null
    })
    setQuery('')
    await refresh()
    await open(n)
  }

  const createFolder = async () => {
    try {
      await window.miny.folders.create(newFolder)
      setNewFolder('')
      setError('')
      void refresh()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div style={{ display: 'flex', gap: 16, height: '100%' }}>
      <aside style={{ width: 240 }}>
        <input placeholder="Search notes" value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: '100%' }} />
        <div style={{ marginTop: 8 }}>
          <button onClick={() => setFilter({ kind: 'all' })}>All</button>{' '}
          <button onClick={() => setFilter({ kind: 'favorites' })}>Favorites</button>{' '}
          <button onClick={() => setFilter({ kind: 'archived' })}>Archived</button>
        </div>
        <h4>Folders</h4>
        {folders.map((f) => (
          <div key={f.id}>
            <button onClick={() => setFilter({ kind: 'folder', id: f.id })}>{f.name}</button>
          </div>
        ))}
        <input placeholder="New folder" value={newFolder} onChange={(e) => setNewFolder(e.target.value)} />
        <button onClick={createFolder}>Add</button>
        <div style={{ marginTop: 12 }}>
          <button onClick={createNote}>New note</button>
        </div>
        <div style={{ marginTop: 12 }}>
          {notes.map((n) => (
            <div
              key={n.id}
              onClick={() => open(n)}
              style={{ padding: 6, cursor: 'pointer', fontWeight: selected?.id === n.id ? 700 : 400 }}
            >
              {n.favorite ? '★ ' : ''}
              {n.title || 'Untitled'}
            </div>
          ))}
        </div>
      </aside>

      {selected && draft && (
        <section style={{ flex: 1 }}>
          <input
            aria-label="Note title"
            value={draft.title}
            onChange={(e) => editDraft({ title: e.target.value })}
            onBlur={() => void flushDraft()}
            style={{ width: '100%', fontSize: 18 }}
          />
          <div style={{ marginTop: 8, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <label>
              <input type="checkbox" checked={selected.favorite} onChange={(e) => saveMeta({ favorite: e.target.checked })} /> Favorite
            </label>
            <label>
              <input type="checkbox" checked={selected.archived} onChange={(e) => saveMeta({ archived: e.target.checked })} /> Archived
            </label>
            <label>
              Folder{' '}
              <select
                value={selected.folder_id ?? ''}
                onChange={(e) => saveMeta({ folder_id: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">(none)</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div style={{ marginTop: 8 }}>
            <input
              placeholder="Tags, comma separated"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              onBlur={saveTags}
              style={{ width: '100%' }}
            />
          </div>
          <textarea
            aria-label="Note body"
            value={draft.body_md}
            onChange={(e) => editDraft({ body_md: e.target.value })}
            onBlur={() => void flushDraft()}
            style={{ width: '100%', height: '45vh', marginTop: 8 }}
          />
          {selected.transcript && (
            <details style={{ marginTop: 8 }}>
              <summary>Transcript</summary>
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: 13, maxHeight: '30vh', overflow: 'auto' }}>
                {selected.transcript}
              </pre>
            </details>
          )}
          {selected.qa?.length > 0 && (
            <details style={{ marginTop: 8 }}>
              <summary>Questions and answers ({selected.qa.length})</summary>
              <div style={{ fontSize: 13, maxHeight: '30vh', overflow: 'auto' }}>
                {selected.qa.map((p, i) => (
                  <div key={i} style={{ marginTop: 8 }}>
                    <div style={{ opacity: 0.7 }}>{p.question}</div>
                    <div style={{ whiteSpace: 'pre-wrap' }}>{p.answer}</div>
                  </div>
                ))}
              </div>
            </details>
          )}
          <div style={{ marginTop: 8 }}>
            <button
              onClick={async () => {
                await flushDraft()
                setExported(`Exported to ${await window.miny.notes.export(selected.id)}`)
              }}
            >
              Export .md
            </button>{' '}
            {selected.session_id !== null && (
              <button onClick={summarize} disabled={summarizing}>
                {summarizing ? 'Summarizing…' : 'Regenerate summary'}
              </button>
            )}
            {exported && <span style={{ marginLeft: 8, fontSize: 13 }}>{exported}</span>}
            {summaryStatus && <span style={{ marginLeft: 8, fontSize: 13, opacity: 0.8 }}>{summaryStatus}</span>}
          </div>
          {error && <p style={{ color: '#b00020' }}>{error}</p>}
        </section>
      )}
    </div>
  )
}
