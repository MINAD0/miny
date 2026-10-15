import type { Note } from '../storage/notes'

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i

export function noteToMarkdown(note: Note, tags: string[]): string {
  const title = note.title.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const tagList = tags.length ? `[${tags.join(', ')}]` : '[]'
  return `---\ntitle: "${title}"\ntags: ${tagList}\ncreated: ${new Date(note.created_at).toISOString()}\n---\n\n${note.body_md}\n`
}

export function safeFilename(title: string, id: number): string {
  const cleaned = title
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100)
    .replace(/[. ]+$/, '')
  if (!cleaned || RESERVED.test(cleaned)) return `note-${id}.md`
  return `${cleaned}.md`
}
