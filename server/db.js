import { DatabaseSync } from "node:sqlite";

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
  // 2: small key/value store for scheduler state (last digest run etc.)
  `CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
];

// Runs fn inside a transaction; rolls back if it throws.
export function transaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export const getMeta = (db, key) => db.prepare("SELECT value FROM meta WHERE key = ?").get(key)?.value ?? null;
export const setMeta = (db, key, value) =>
  db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, String(value));
export const schemaVersion = db => db.prepare("PRAGMA user_version").get().user_version;

export function openDb(path) {
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  db.exec(SCHEMA);
  for (let v = schemaVersion(db); v < MIGRATIONS.length; v++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
  return db;
}
