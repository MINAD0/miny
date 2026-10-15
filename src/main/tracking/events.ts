import type Database from 'better-sqlite3'

const CONSENT_KEY = 'tracking.consent'

export function createTracker(db: Database.Database, opts: { now?: () => number } = {}) {
  const now = opts.now ?? (() => Date.now())

  const getSetting = (key: string): unknown => {
    const r = db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key) as { value_json: string } | undefined
    return r ? JSON.parse(r.value_json) : undefined
  }
  const setSetting = (key: string, value: unknown) =>
    db
      .prepare('INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json')
      .run(key, JSON.stringify(value))

  const hasConsent = (): boolean => getSetting(CONSENT_KEY) === true

  return {
    setConsent(granted: boolean) {
      setSetting(CONSENT_KEY, granted)
    },
    hasConsent,
    record(name: string, props: Record<string, unknown> = {}) {
      if (!hasConsent()) return
      db.prepare('INSERT INTO events (name, props_json, created_at) VALUES (?, ?, ?)').run(name, JSON.stringify(props), now())
    },
    activityLog(limit = 200) {
      return (
        db.prepare('SELECT name, props_json, created_at FROM events ORDER BY id DESC LIMIT ?').all(limit) as {
          name: string
          props_json: string
          created_at: number
        }[]
      ).map((r) => ({ name: r.name, props: JSON.parse(r.props_json), created_at: r.created_at }))
    },
    revokeAndWipe() {
      db.transaction(() => {
        db.prepare('DELETE FROM events').run()
        setSetting(CONSENT_KEY, false)
      })()
    }
  }
}
