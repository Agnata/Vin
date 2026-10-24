import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { schemaVersion } from "./db.js";

// Each backup is a directory  vin-YYYYMMDD-HHMMSS/  with vin.db (a consistent copy made by
// SQLite's VACUUM INTO, safe while the app runs), photos/ (label photos) and manifest.json. While being written the
// directory ends in .partial, so unfinished backups are never listed, restored or copied offsite.
const NAME = /^vin-\d{8}-\d{6}$/;

const sha256File = file => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

export function listBackups(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(n => NAME.test(n)).sort().reverse().flatMap(name => {
    try {
      const manifest = JSON.parse(fs.readFileSync(path.join(dir, name, "manifest.json"), "utf8"));
      return [{ name, ...manifest }];
    } catch { return []; }
  });
}

export function backupFile(dir, name) {
  if (!NAME.test(String(name))) return null;
  const file = path.join(dir, name, "vin.db");
  return fs.existsSync(file) ? file : null;
}

export function createBackup(db, dir, keep = 30, now = new Date(), photosDir = null) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const name = "vin-" + now.toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
  const partial = path.join(dir, name + ".partial");
  const final = path.join(dir, name);
  if (fs.existsSync(final)) throw new Error(`Backupen ${name} finns redan.`);
  fs.rmSync(partial, { recursive: true, force: true });
  fs.mkdirSync(partial);
  try {
    const file = path.join(partial, "vin.db");
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    // Photos named in the database; files are immutable, so a plain copy is consistent.
    const photos = [];
    if (photosDir) {
      fs.mkdirSync(path.join(partial, "photos"));
      for (const { photo } of db.prepare("SELECT photo FROM wines WHERE photo IS NOT NULL").all()) {
        for (const name of [`${photo}.jpg`, `${photo}-thumb.jpg`]) {
          const src = path.join(photosDir, name);
          if (!fs.existsSync(src)) continue;
          fs.copyFileSync(src, path.join(partial, "photos", name));
          photos.push({ file: name, sha256: sha256File(src) });
        }
      }
    }
    const manifest = {
      app: "vinkallaren",
      created: now.toISOString(),
      schema: schemaVersion(db),
      file: "vin.db",
      size: fs.statSync(file).size,
      sha256: sha256File(file),
      wines: db.prepare("SELECT COUNT(*) AS n FROM wines").get().n,
      users: db.prepare("SELECT COUNT(*) AS n FROM users").get().n,
      photos,
    };
    fs.writeFileSync(path.join(partial, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    fs.renameSync(partial, final);
    prune(dir, keep);
    return { name, ...manifest };
  } catch (err) {
    fs.rmSync(partial, { recursive: true, force: true });
    throw err;
  }
}

// Keeps the newest `keep` complete backups and removes leftovers from interrupted runs.
function prune(dir, keep) {
  for (const b of listBackups(dir).slice(keep)) fs.rmSync(path.join(dir, b.name), { recursive: true, force: true });
  for (const n of fs.readdirSync(dir)) {
    if (!n.endsWith(".partial")) continue;
    const p = path.join(dir, n);
    if (Date.now() - fs.statSync(p).mtimeMs > 36e5) fs.rmSync(p, { recursive: true, force: true });
  }
}

export function verifyBackup(dir, name) {
  const b = listBackups(dir).find(x => x.name === name);
  const file = backupFile(dir, name);
  return !!(b && file && sha256File(file) === b.sha256);
}

// Written by deploy/vinkallaren-backup-offsite.sh after each rsync run.
export function offsiteStatus(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, "offsite.json"), "utf8")); } catch { return null; }
}

// Restores the cellar (wines and their history) from a backup. Accounts, sessions and settings
// are left alone so nobody is locked out. A rescue backup of the current state is taken first.
export function restoreBackup(db, dir, name, keep = 30, photosDir = null) {
  const backup = listBackups(dir).find(b => b.name === name);
  const file = backupFile(dir, name);
  if (!backup || !file) throw new Error("Backupen finns inte.");
  if (sha256File(file) !== backup.sha256) throw new Error("Kontrollsumman stämmer inte. Backupen kan vara skadad.");
  if (backup.schema > schemaVersion(db)) throw new Error("Backupen kommer från en nyare version av appen.");
  for (const p of backup.photos || []) {
    const f = path.join(dir, name, "photos", p.file);
    if (!fs.existsSync(f) || sha256File(f) !== p.sha256) throw new Error(`Fotot ${p.file} saknas eller är skadat i backupen.`);
  }

  let rescue;
  for (let i = 0; !rescue; i++) {
    try { rescue = createBackup(db, dir, keep + 1, new Date(Date.now() + i * 1000), photosDir); }
    catch (err) { if (i >= 5 || !/finns redan/.test(err.message)) throw err; }
  }

  db.prepare("ATTACH DATABASE ? AS src").run(file);
  try {
    const cols = (schema, table) => db.prepare(`SELECT name FROM ${schema}.pragma_table_info('${table}')`).all().map(r => r.name);
    const common = table => { const src = new Set(cols("src", table)); return cols("main", table).filter(c => src.has(c)); };
    const wineCols = common("wines").join(", ");
    const eventCols = common("events");
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec("DELETE FROM main.events; DELETE FROM main.wines;");
      db.exec(`INSERT INTO main.wines (${wineCols}) SELECT ${wineCols} FROM src.wines`);
      // History may name users that no longer exist; keep the event without the name.
      const sel = eventCols.map(c => c === "user_id" ? "CASE WHEN user_id IN (SELECT id FROM main.users) THEN user_id END" : c).join(", ");
      db.exec(`INSERT INTO main.events (${eventCols.join(", ")}) SELECT ${sel} FROM src.events`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  } finally {
    db.exec("DETACH DATABASE src");
  }
  // Put the backup's photos back and drop files no wine refers to any more
  // (they are still in the rescue backup).
  if (photosDir) {
    fs.mkdirSync(photosDir, { recursive: true, mode: 0o700 });
    for (const p of backup.photos || []) fs.copyFileSync(path.join(dir, name, "photos", p.file), path.join(photosDir, p.file));
    const keepIds = new Set(db.prepare("SELECT photo FROM wines WHERE photo IS NOT NULL").all().map(r => r.photo));
    for (const f of fs.readdirSync(photosDir)) {
      const id = f.replace(/(-thumb)?\.jpg$/, "");
      if (!keepIds.has(id)) fs.rmSync(path.join(photosDir, f), { force: true });
    }
  }
  const wines = db.prepare("SELECT COUNT(*) AS n FROM wines").get().n;
  return { restored: name, rescue: rescue.name, wines };
}
