import { describe, expect, it } from 'vitest'
import { noteToMarkdown, safeFilename } from '../../../src/main/export/markdown'

const note = {
  id: 7,
  title: 'Q3: plans / ideas',
  body_md: 'Body text',
  folder_id: null,
  favorite: false,
  archived: false,
  session_id: null,
  transcript: '',
  qa: [],
  created_at: 0,
  updated_at: 0
}

describe('noteToMarkdown', () => {
  it('writes frontmatter with title and tags, then the body', () => {
    const md = noteToMarkdown(note, ['work', 'q3'])
    expect(md).toContain('title: "Q3: plans / ideas"')
    expect(md).toContain('tags: [work, q3]')
    expect(md.endsWith('Body text\n')).toBe(true)
  })

  it('escapes quotes in the title', () => {
    const md = noteToMarkdown({ ...note, title: 'say "hi"' }, [])
    expect(md).toContain('title: "say \\"hi\\""')
  })

  it('appends the transcript and Q&A to a session note', () => {
    const md = noteToMarkdown(
      {
        ...note,
        transcript: 'What is a closure?',
        qa: [{ question: 'What is a closure?', answer: 'A function with its lexical scope.' }]
      },
      []
    )
    expect(md).toContain('## Transcript')
    expect(md).toContain('What is a closure?')
    expect(md).toContain('## Questions and answers')
    expect(md).toContain('**A:** A function with its lexical scope.')
  })
})

describe('safeFilename', () => {
  it('removes characters Windows forbids', () => {
    const f = safeFilename('a/b\\c:d*e?f"g<h>i|j', 3)
    expect(f).not.toMatch(/[\\/:*?"<>|]/)
    expect(f.endsWith('.md')).toBe(true)
  })

  it('keeps emoji and unicode letters', () => {
    expect(safeFilename('مقابلة 🚀', 1)).toBe('مقابلة 🚀.md')
  })

  it('caps length so the path stays under Windows limits', () => {
    expect(safeFilename('x'.repeat(500), 9).length).toBeLessThanOrEqual(120)
  })

  it('falls back to an id name when the title is empty or only forbidden characters', () => {
    expect(safeFilename('', 12)).toBe('note-12.md')
    expect(safeFilename('///', 12)).toBe('note-12.md')
  })

  it('avoids Windows reserved device names', () => {
    expect(safeFilename('CON', 4)).toBe('note-4.md')
  })
})
