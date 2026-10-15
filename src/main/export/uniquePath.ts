import { existsSync } from 'node:fs'
import { join, parse } from 'node:path'

// Returns dir/name, or "name (2).md", "name (3).md"... if that file already exists.
export function uniquePath(dir: string, filename: string, exists: (p: string) => boolean = existsSync): string {
  const first = join(dir, filename)
  if (!exists(first)) return first
  const { name, ext } = parse(filename)
  for (let n = 2; ; n++) {
    const p = join(dir, `${name} (${n})${ext}`)
    if (!exists(p)) return p
  }
}
