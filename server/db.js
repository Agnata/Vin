import Database from "better-sqlite3";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wines (
  id          INTEGER PRIMARY KEY,
  type        TEXT NOT NULL CHECK (type IN ('rott','vitt','rose','bubbel','orange')),
  name        TEXT NOT NULL,
  producer    TEXT NOT NULL DEFAULT '',
  grapes      TEXT NOT NULL DEFAULT '',
  vintage     TEXT NOT NULL DEFAULT '',
  country     TEXT NOT NULL DEFAULT '',
  region      TEXT NOT NULL DEFAULT '',
  style       TEXT NOT NULL DEFAULT '',
  quantity    INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 0),
  opened      INTEGER NOT NULL DEFAULT 0,
  drink_from  INTEGER,
  drink_to    INTEGER,
  taste_kind  TEXT CHECK (taste_kind IN ('r','w')),
  taste1      INTEGER,
  taste2      INTEGER,
  taste3      INTEGER,
  note        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- History: added, drank, opened, edited, deleted.
CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY,
  wine_id    INTEGER NOT NULL,
  user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  kind       TEXT NOT NULL,
  detail     TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS events_wine ON events(wine_id);
`;

export function openDb(path) {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  return db;
}
