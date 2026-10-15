import { useEffect, useState } from 'react'

type Note = {
  id: number
  title: string
  body_md: string
  folder_id: number | null
  favorite: boolean
  archived: boolean
  updated_at: number
}
type Folder = { id: number; name: string; parent_id: number | null }
type Filter = { kind: 'all' } | { kind: 'favorites' } | { kind: 'archived' } | { kind: 'folder'; id: number }

export function NotesView() {
  const [notes, setNotes] = useState<Note[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [filter, setFilter] = useState<Filter>({ kind: 'all' })
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Note | null>(null)
  const [tags, setTags] = useState('')
  const [newFolder, setNewFolder] = useState('')
  const [error, setError] = useState('')

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

  const open = async (n: Note) => {
    setSelected(n)
    setTags((await window.miny.notes.tags(n.id)).join(', '))
  }

  const save = async (patch: Partial<Note>) => {
    if (!selected) return
    try {
      const updated = await window.miny.notes.update(selected.id, patch)
      setSelected(updated)
      setError('')
      void refresh()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const saveTags = async () => {
    if (!selected) return
    await window.miny.notes.setTags(selected.id, tags.split(',').map((t) => t.trim()))
  }

  const createNote = async () => {
    const n = await window.miny.notes.create({
      title: 'Untitled',
      folder_id: filter.kind === 'folder' ? filter.id : null
    })
    setQuery('')
    await refresh()
    void open(n)
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
            <div key={n.id} onClick={() => open(n)} style={{ padding: 6, cursor: 'pointer', fontWeight: selected?.id === n.id ? 700 : 400 }}>
              {n.favorite ? '★ ' : ''}
              {n.title || 'Untitled'}
            </div>
          ))}
        </div>
      </aside>

      {selected && (
        <section style={{ flex: 1 }}>
          <input value={selected.title} onChange={(e) => save({ title: e.target.value })} style={{ width: '100%', fontSize: 18 }} />
          <div style={{ marginTop: 8, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <label>
              <input type="checkbox" checked={selected.favorite} onChange={(e) => save({ favorite: e.target.checked })} /> Favorite
            </label>
            <label>
              <input type="checkbox" checked={selected.archived} onChange={(e) => save({ archived: e.target.checked })} /> Archived
            </label>
            <label>
              Folder{' '}
              <select value={selected.folder_id ?? ''} onChange={(e) => save({ folder_id: e.target.value ? Number(e.target.value) : null })}>
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
            <input placeholder="Tags, comma separated" value={tags} onChange={(e) => setTags(e.target.value)} onBlur={saveTags} style={{ width: '100%' }} />
          </div>
          <textarea value={selected.body_md} onChange={(e) => save({ body_md: e.target.value })} style={{ width: '100%', height: '60vh', marginTop: 8 }} />
          <div style={{ marginTop: 8 }}>
            <button onClick={() => window.miny.notes.export(selected.id)}>Export .md</button>
          </div>
          {error && <p style={{ color: '#b00020' }}>{error}</p>}
        </section>
      )}
    </div>
  )
}
