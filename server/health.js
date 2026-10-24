import fs from "node:fs";
import { listBackups, offsiteStatus } from "./backups.js";

const MAX_AGE_H = 30;
const MIN_FREE_MB = 500;
const hoursSince = iso => (Date.now() - new Date(iso).getTime()) / 36e5;

// Same checks as LB3: database, local backup, offsite copy and free disk. ok=false -> HTTP 503.
export function health(db, config) {
  const checks = {};

  try {
    db.prepare("SELECT 1").get();
    checks.database = { ok: true };
  } catch (err) {
    checks.database = { ok: false, error: err.message };
  }

  const last = listBackups(config.backupDir)[0];
  checks.backup = last
    ? { ok: hoursSince(last.created) <= MAX_AGE_H, last: last.created }
    : { ok: false, last: null };

  if (!config.offsiteTarget) {
    checks.offsite = { ok: true, status: "off" };
  } else {
    const s = offsiteStatus(config.backupDir);
    checks.offsite = { ok: !!s?.lastSuccess && hoursSince(s.lastSuccess) <= MAX_AGE_H, last: s?.lastSuccess ?? null };
    if (s && s.ok === false) checks.offsite.error = "Senaste kopieringen misslyckades";
  }

  try {
    const st = fs.statfsSync(config.dataDir);
    const freeMB = Math.floor((st.bavail * st.bsize) / 1048576);
    checks.disk = { ok: freeMB >= MIN_FREE_MB, freeMB };
  } catch (err) {
    checks.disk = { ok: false, error: err.message };
  }

  return { ok: Object.values(checks).every(c => c.ok), checks };
}
