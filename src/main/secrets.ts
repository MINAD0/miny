import { existsSync, readFileSync, writeFileSync } from 'node:fs'

type SafeStorageLike = {
  isEncryptionAvailable(): boolean
  encryptString(s: string): Buffer
  decryptString(b: Buffer): string
}

export function createSecretStore(opts: { safeStorage: SafeStorageLike; file: string }) {
  const { safeStorage, file } = opts

  function load(): Record<string, string> {
    if (!existsSync(file)) return {}
    return JSON.parse(readFileSync(file, 'utf8'))
  }

  return {
    set(name: string, value: string): void {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('OS encryption is unavailable; refusing to store the API key')
      }
      const all = load()
      all[name] = safeStorage.encryptString(value).toString('base64')
      writeFileSync(file, JSON.stringify(all, null, 2))
    },
    get(name: string): string | null {
      const all = load()
      if (!(name in all)) return null
      return safeStorage.decryptString(Buffer.from(all[name], 'base64'))
    },
    delete(name: string): void {
      const all = load()
      delete all[name]
      writeFileSync(file, JSON.stringify(all, null, 2))
    }
  }
}
