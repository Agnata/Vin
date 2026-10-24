import { Router } from "express";
import crypto from "node:crypto";
import { hashPassword } from "../auth.js";
import { inviteMail, resetMail } from "../mail-templates.js";
import { listBackups, createBackup, backupFile, offsiteStatus } from "../backups.js";
import { health } from "../health.js";
import { getMeta } from "../db.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// User administration. Mounted behind requireAdmin.
export function adminRouter(db, auth, mailer, config) {
  const r = Router();
  const q = {
    list: db.prepare(`SELECT id, email, name, is_admin, digest, created_at, last_login_at,
                      EXISTS (SELECT 1 FROM password_tokens t WHERE t.user_id = users.id AND t.purpose = 'invite'
                              AND t.expires_at > datetime('now')) AS invited
                      FROM users ORDER BY name COLLATE NOCASE`),
    get: db.prepare("SELECT * FROM users WHERE id = ?"),
    byEmail: db.prepare("SELECT id FROM users WHERE email = ?"),
    admins: db.prepare("SELECT COUNT(*) AS n FROM users WHERE is_admin = 1"),
  };
  const publicUser = id => q.list.all().find(u => u.id === id);

  const load = (req, res, next) => {
    req.target = q.get.get(Number(req.params.id));
    if (!req.target) return res.status(404).json({ error: "Användaren finns inte." });
    next();
  };

  // Mails a one-time link; returns the link itself when e-mail is not configured so the admin can pass it on.
  async function sendLink(user, purpose, invitedBy) {
    const token = auth.createPasswordToken(user.id, purpose);
    const link = `${config.baseUrl}/losenord?t=${token}`;
    const mail = purpose === "invite" ? inviteMail({ name: user.name, link, invitedBy }) : resetMail({ name: user.name, link });
    try {
      await mailer.send({ to: user.email, ...mail });
    } catch (err) {
      console.error("Kunde inte skicka länk:", err.message);
      return { link, mailed: false };
    }
    return mailer.enabled ? { mailed: true } : { link, mailed: false };
  }

  function clean(body, partial) {
    const out = {};
    if (!partial || "email" in body) {
      const email = String(body.email || "").trim();
      if (!EMAIL.test(email) || email.length > 200) return [null, "Ange en giltig e-postadress."];
      out.email = email;
    }
    if (!partial || "name" in body) {
      const name = String(body.name || "").trim();
      if (!name || name.length > 100) return [null, "Ange ett namn (högst 100 tecken)."];
      out.name = name;
    }
    if ("is_admin" in body) out.is_admin = body.is_admin ? 1 : 0;
    return [out, null];
  }

  r.get("/users", (_req, res) => res.json({ users: q.list.all(), mail: mailer.enabled }));

  r.post("/users", async (req, res) => {
    const [fields, err] = clean(req.body || {}, false);
    if (err) return res.status(400).json({ error: err });
    if (q.byEmail.get(fields.email)) return res.status(409).json({ error: "Det finns redan en användare med den e-postadressen." });
    // Random password nobody knows; the user picks their own via the invite link.
    const info = db.prepare("INSERT INTO users (email, name, is_admin, password_hash) VALUES (?, ?, ?, ?)")
      .run(fields.email, fields.name, fields.is_admin || 0, hashPassword(crypto.randomBytes(24).toString("hex")));
    const user = q.get.get(info.lastInsertRowid);
    const sent = await sendLink(user, "invite", req.user.name);
    res.status(201).json({ user: publicUser(user.id), ...sent });
  });

  r.patch("/users/:id", load, (req, res) => {
    const [fields, err] = clean(req.body || {}, true);
    if (err) return res.status(400).json({ error: err });
    if (fields.email && fields.email.toLowerCase() !== req.target.email.toLowerCase() && q.byEmail.get(fields.email)) {
      return res.status(409).json({ error: "Det finns redan en användare med den e-postadressen." });
    }
    if (fields.is_admin === 0 && req.target.is_admin) {
      if (req.target.id === req.user.id) return res.status(400).json({ error: "Du kan inte ta bort din egen administratörsroll." });
      if (q.admins.get().n <= 1) return res.status(400).json({ error: "Det måste finnas minst en administratör." });
    }
    const cols = Object.keys(fields);
    if (cols.length) db.prepare(`UPDATE users SET ${cols.map(c => `${c} = @${c}`).join(", ")} WHERE id = @id`).run({ ...fields, id: req.target.id });
    res.json(publicUser(req.target.id));
  });

  // Sends a new invite (never signed in) or a password reset link.
  r.post("/users/:id/link", load, async (req, res) => {
    const purpose = req.target.last_login_at ? "reset" : "invite";
    res.json({ purpose, ...(await sendLink(req.target, purpose, req.user.name)) });
  });

  r.delete("/users/:id", load, (req, res) => {
    if (req.target.id === req.user.id) return res.status(400).json({ error: "Du kan inte ta bort dig själv." });
    if (req.target.is_admin && q.admins.get().n <= 1) return res.status(400).json({ error: "Det måste finnas minst en administratör." });
    db.prepare("DELETE FROM users WHERE id = ?").run(req.target.id);
    res.status(204).end();
  });

  // ---- operations: health and backups ----
  r.get("/system", (_req, res) => {
    res.json({
      health: health(db, config),
      backups: listBackups(config.backupDir).slice(0, 30),
      backupError: getMeta(db, "backup_error") || null,
      offsite: config.offsiteTarget ? offsiteStatus(config.backupDir) || {} : null,
      mail: mailer.enabled,
    });
  });

  r.post("/backups", (_req, res) => {
    try {
      res.status(201).json(createBackup(db, config.backupDir, config.backupKeep));
    } catch (err) {
      res.status(500).json({ error: `Backupen misslyckades: ${err.message}` });
    }
  });

  r.get("/backups/:name/download", (req, res) => {
    const file = backupFile(config.backupDir, req.params.name);
    if (!file) return res.status(404).json({ error: "Backupen finns inte." });
    res.download(file, `vinkallaren-${req.params.name}.db`);
  });

  return r;
}
