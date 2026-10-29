import Database from 'better-sqlite3'

const MIGRATIONS: string[] = [
  `
  CREATE TABLE folders (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    parent_id INTEGER REFERENCES folders(id) ON DELETE SET NULL
  );
  CREATE TABLE sessions (
    id INTEGER PRIMARY KEY,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    mode TEXT NOT NULL,
    provider TEXT,
    model TEXT
  );
  CREATE TABLE notes (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    body_md TEXT NOT NULL DEFAULT '',
    folder_id INTEGER REFERENCES folders(id) ON DELETE SET NULL,
    favorite INTEGER NOT NULL DEFAULT 0,
    archived INTEGER NOT NULL DEFAULT 0,
    session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE tags (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
  );
  CREATE TABLE note_tags (
    note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (note_id, tag_id)
  );
  CREATE TABLE segments (
    id INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    t_start INTEGER NOT NULL,
    t_end INTEGER NOT NULL,
    text TEXT NOT NULL
  );
  CREATE TABLE events (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    props_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  );
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL
  );
  CREATE VIRTUAL TABLE notes_fts USING fts5(
    title, body_md, content='notes', content_rowid='id'
  );
  CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN
    INSERT INTO notes_fts(rowid, title, body_md) VALUES (new.id, new.title, new.body_md);
  END;
  CREATE TRIGGER notes_ad AFTER DELETE ON notes BEGIN
    INSERT INTO notes_fts(notes_fts, rowid, title, body_md) VALUES ('delete', old.id, old.title, old.body_md);
  END;
  CREATE TRIGGER notes_au AFTER UPDATE ON notes BEGIN
    INSERT INTO notes_fts(notes_fts, rowid, title, body_md) VALUES ('delete', old.id, old.title, old.body_md);
    INSERT INTO notes_fts(rowid, title, body_md) VALUES (new.id, new.title, new.body_md);
  END;
  `,
  `
  -- Session records keep the raw transcript and the answers separately from the
  -- generated summary, so a failed summary never destroys what was heard.
  ALTER TABLE notes ADD COLUMN transcript TEXT NOT NULL DEFAULT '';
  ALTER TABLE notes ADD COLUMN qa_json TEXT NOT NULL DEFAULT '[]';

  CREATE TABLE context_docs (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('resume', 'document')),
    name TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX context_docs_one_resume ON context_docs(kind) WHERE kind = 'resume';
  `
]

export function openDb(path: string): Database.Database {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

function migrate(db: Database.Database): void {
  const current = db.pragma('user_version', { simple: true }) as number
  for (let i = current; i < MIGRATIONS.length; i++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[i])
      db.pragma(`user_version = ${i + 1}`)
    })()
  }
}
