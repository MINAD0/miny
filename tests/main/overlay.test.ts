import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? sourceFiles(p) : /\.(ts|tsx)$/.test(name) ? [p] : []
  })
}

describe('overlay privacy constraint', () => {
  it('no source file enables content protection, so no window is hidden from captures', () => {
    const offenders = sourceFiles(join(process.cwd(), 'src')).filter((f) => /setContentProtection/.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
})
