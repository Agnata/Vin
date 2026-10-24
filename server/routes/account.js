import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireUser, verifyPassword, hashPassword, passwordProblem } from "../auth.js";
import { resetMail } from "../mail-templates.js";

const DIGESTS = ["off", "daily", "weekly"];

// Own account (signed in) and password links (public).
export function accountRouter(db, auth, mailer, config) {
  const r = Router();
  const get = db.prepare("SELECT id, email, name, is_admin, digest FROM users WHERE id = ?");
  const limiter = rateLimit({ windowMs: 15 * 60e3, limit: 10, standardHeaders: "draft-8", legacyHeaders: false,
    message: { error: "För många försök. Vänta en kvart och försök igen." } });

  r.get("/account", requireUser, (req, res) => res.json({ ...get.get(req.user.id), mail: mailer.enabled }));

  r.patch("/account", requireUser, (req, res) => {
    const fields = {};
    if ("name" in req.body) {
      const name = String(req.body.name || "").trim();
      if (!name || name.length > 100) return res.status(400).json({ error: "Ange ett namn (högst 100 tecken)." });
      fields.name = name;
    }
    if ("digest" in req.body) {
      if (!DIGESTS.includes(req.body.digest)) return res.status(400).json({ error: "Okänt val för e-post." });
      fields.digest = req.body.digest;
      // Start the first digest from now instead of replaying old history.
      fields.digest_sent_at = new Date().toISOString().replace("T", " ").slice(0, 19);
    }
    const cols = Object.keys(fields);
    if (cols.length) db.prepare(`UPDATE users SET ${cols.map(c => `${c} = @${c}`).join(", ")} WHERE id = @id`).run({ ...fields, id: req.user.id });
    res.json({ ...get.get(req.user.id), mail: mailer.enabled });
  });

  r.post("/account/password", requireUser, limiter, (req, res) => {
    const { current, password } = req.body || {};
    const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.user.id);
    if (!verifyPassword(String(current || ""), row.password_hash)) return res.status(400).json({ error: "Nuvarande lösenord stämmer inte." });
    const problem = passwordProblem(password);
    if (problem) return res.status(400).json({ error: problem });
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hashPassword(password), req.user.id);
    auth.endOtherSessions(req, req.user.id);
    res.json({ ok: true });
  });

  // ---- password links (invite / reset) ----
  r.post("/password/forgot", limiter, async (req, res) => {
    const user = db.prepare("SELECT id, name, email FROM users WHERE email = ?").get(String(req.body?.email || "").trim());
    if (user) {
      const token = auth.createPasswordToken(user.id, "reset");
      try {
        await mailer.send({ to: user.email, ...resetMail({ name: user.name, link: `${config.baseUrl}/losenord?t=${token}` }) });
      } catch (err) { console.error("Återställningsmejl:", err.message); }
    }
    // Same answer whether or not the account exists.
    res.json({ ok: true, mail: mailer.enabled });
  });

  r.get("/password/token", (req, res) => {
    const found = auth.findPasswordToken(req.query.t);
    if (!found) return res.status(404).json({ error: "Länken är ogiltig eller har gått ut." });
    res.json({ name: found.name, email: found.email, purpose: found.purpose });
  });

  r.post("/password/set", limiter, (req, res) => {
    const problem = passwordProblem(req.body?.password);
    if (problem) return res.status(400).json({ error: problem });
    const user = auth.usePasswordToken(req.body?.token, req.body.password);
    if (!user) return res.status(400).json({ error: "Länken är ogiltig eller har gått ut." });
    auth.startSession(res, user.id);
    res.json({ ok: true });
  });

  return r;
}
