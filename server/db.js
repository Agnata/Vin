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

// Changes to existing databases, applied in order. Index + 1 = PRAGMA user_version.
const MIGRATIONS = [
  // 1: admin role, e-mail digests, password links
  `ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE users ADD COLUMN digest TEXT NOT NULL DEFAULT 'off' CHECK (digest IN ('off','daily','weekly'));
   ALTER TABLE users ADD COLUMN digest_sent_at TEXT;
   ALTER TABLE users ADD COLUMN unsubscribe_token TEXT;
   ALTER TABLE users ADD COLUMN last_login_at TEXT;
   CREATE TABLE password_tokens (
     token_hash TEXT PRIMARY KEY,
     user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     purpose    TEXT NOT NULL CHECK (purpose IN ('invite','reset')),
     expires_at TEXT NOT NULL
   );`,
];

export function openDb(path) {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  const version = db.pragma("user_version", { simple: true });
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
  return db;
}
