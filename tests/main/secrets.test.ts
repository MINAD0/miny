import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createSecretStore } from '../../src/main/secrets'

const fakeSafe = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from('enc:' + s, 'utf8'),
  decryptString: (b: Buffer) => b.toString('utf8').replace(/^enc:/, '')
}

describe('secret store', () => {
  it('round-trips a key and never writes plaintext to disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'miny-sec-'))
    const file = join(dir, 'secrets.json')
    const store = createSecretStore({ safeStorage: fakeSafe as any, file })
    store.set('openai', 'sk-plain-123')
    expect(store.get('openai')).toBe('sk-plain-123')
    expect(readFileSync(file, 'utf8')).not.toContain('sk-plain-123')
  })

  it('returns null for a missing key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'miny-sec-'))
    const store = createSecretStore({ safeStorage: fakeSafe as any, file: join(dir, 's.json') })
    expect(store.get('nope')).toBeNull()
  })

  it('refuses to store when OS encryption is unavailable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'miny-sec-'))
    const off = { ...fakeSafe, isEncryptionAvailable: () => false }
    const store = createSecretStore({ safeStorage: off as any, file: join(dir, 's.json') })
    expect(() => store.set('openai', 'sk')).toThrow(/encryption/i)
  })
})
