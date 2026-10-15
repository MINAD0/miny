import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('overlay privacy constraint', () => {
  it('never touches content protection, so the overlay is not hidden from captures', () => {
    const src = readFileSync(join(process.cwd(), 'src/main/overlay.ts'), 'utf8')
    expect(src).not.toMatch(/setContentProtection/)
  })
})
