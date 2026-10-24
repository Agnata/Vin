import crypto from "node:crypto";
import { digestMail } from "./mail-templates.js";
import { stockholm } from "./clock.js";

export function unsubscribeToken(db, user) {
  if (user.unsubscribe_token) return user.unsubscribe_token;
  const token = crypto.randomBytes(24).toString("base64url");
  db.prepare("UPDATE users SET unsubscribe_token = ? WHERE id = ?").run(token, user.id);
  return token;
}

// Sends due digests. Daily subscribers get one when something happened since the last one;
// weekly subscribers get one on Mondays if anything happened or a wine should be drunk soon.
export async function sendDigests(db, mailer, config, now = new Date()) {
  const isMonday = stockholm(now).weekday === 1;
  const year = Number(stockholm(now).date.slice(0, 4));
  const users = db.prepare("SELECT * FROM users WHERE digest != 'off'").all();
  const eventsSince = db.prepare(`
    SELECT e.kind, e.detail, e.created_at, u.name AS user, COALESCE(w.name, e.detail) AS name, w.type, w.vintage
    FROM events e LEFT JOIN wines w ON w.id = e.wine_id LEFT JOIN users u ON u.id = e.user_id
    WHERE e.kind IN ('added','drank','opened','deleted') AND e.created_at > ? AND e.detail != 'import'
    ORDER BY e.id LIMIT 100`);
  const soon = db.prepare(`SELECT name, vintage, type, drink_to FROM wines
    WHERE quantity > 0 AND drink_to IS NOT NULL AND drink_to <= ? ORDER BY drink_to, name LIMIT 8`).all(year);
  const markSent = db.prepare("UPDATE users SET digest_sent_at = datetime('now') WHERE id = ?");

  const result = { sent: 0, skipped: 0, failed: 0 };
  for (const user of users) {
    if (user.digest === "weekly" && !isMonday) { result.skipped++; continue; }
    const since = user.digest_sent_at || new Date(now - (user.digest === "weekly" ? 7 : 1) * 864e5).toISOString().replace("T", " ").slice(0, 19);
    const events = eventsSince.all(since);
    const reminders = user.digest === "weekly" ? soon : [];
    if (!events.length && !reminders.length) { result.skipped++; continue; }

    const token = unsubscribeToken(db, user);
    const mail = digestMail({
      name: user.name, period: user.digest, events, soon: reminders, baseUrl: config.baseUrl,
      unsubscribeUrl: `${config.baseUrl}/avregistrera?t=${token}`, settingsUrl: `${config.baseUrl}/konto`,
    });
    try {
      await mailer.send({ to: user.email, ...mail });
      markSent.run(user.id);
      result.sent++;
    } catch (err) {
      console.error(`Kunde inte skicka till ${user.email}:`, err.message);
      result.failed++;
    }
  }
  return result;
}
