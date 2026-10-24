// Writes a consistent copy of the database and keeps the newest KEEP copies.
// Usage: npm run backup -- /var/backups/vinkallaren
import fs from "node:fs";
import path from "node:path";
import { config } from "../server/config.js";
import { openDb } from "../server/db.js";

const dir = process.argv[2] || process.env.BACKUP_DIR || "./backups";
const keep = Number(process.env.BACKUP_KEEP || 30);
fs.mkdirSync(dir, { recursive: true });

const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
const file = path.join(dir, `vin-${stamp}.db`);
const db = openDb(config.dbPath);
await db.backup(file);
db.close();

const old = fs.readdirSync(dir).filter(f => /^vin-.*\.db$/.test(f)).sort().slice(0, -keep);
for (const f of old) fs.unlinkSync(path.join(dir, f));
console.log(`Backup: ${file}${old.length ? ` (tog bort ${old.length} gamla)` : ""}`);
