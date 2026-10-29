import type { Note } from '../storage/notes'

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i

export function noteToMarkdown(note: Note, tags: string[]): string {
  const title = note.title.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const tagList = tags.length ? `[${tags.join(', ')}]` : '[]'
  const parts = [note.body_md]
  const transcript = note.transcript ?? ''
  if (transcript.trim()) parts.push(`## Transcript\n\n${transcript.trim()}`)
  if (note.qa?.length) {
    parts.push(
      '## Questions and answers\n\n' +
        note.qa
          .map((p) => `**Q:** ${p.question}\n\n**A:** ${p.answer}`)
          .join('\n\n')
    )
  }
  const body = parts.filter((p) => p.trim()).join('\n\n')
  return `---\ntitle: "${title}"\ntags: ${tagList}\ncreated: ${new Date(note.created_at).toISOString()}\n---\n\n${body}\n`
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
