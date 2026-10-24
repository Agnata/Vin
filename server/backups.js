import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { schemaVersion } from "./db.js";

// Each backup is a directory  vin-YYYYMMDD-HHMMSS/  with vin.db (a consistent copy made by
// SQLite's VACUUM INTO, safe while the app runs) and manifest.json. While being written the
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

export function createBackup(db, dir, keep = 30, now = new Date()) {
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
    const manifest = {
      app: "vinkallaren",
      created: now.toISOString(),
      schema: schemaVersion(db),
      file: "vin.db",
      size: fs.statSync(file).size,
      sha256: sha256File(file),
      wines: db.prepare("SELECT COUNT(*) AS n FROM wines").get().n,
      users: db.prepare("SELECT COUNT(*) AS n FROM users").get().n,
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
