import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { uniquePath } from '../../../src/main/export/uniquePath'

describe('uniquePath', () => {
  it('keeps the name when nothing exists', () => {
    expect(uniquePath('d', 'Untitled.md', () => false)).toBe(join('d', 'Untitled.md'))
  })

  it('numbers the file when the name is taken', () => {
    const taken = new Set([join('d', 'Untitled.md'), join('d', 'Untitled (2).md')])
    expect(uniquePath('d', 'Untitled.md', (p) => taken.has(p))).toBe(join('d', 'Untitled (3).md'))
  })
})
