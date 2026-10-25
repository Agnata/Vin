import { Router } from "express";
import rateLimit from "express-rate-limit";
import { requireUser, verifyPassword, hashPassword, passwordProblem } from "../auth.js";
import { resetMail } from "../mail-templates.js";
import { otpauthUri } from "../totp.js";
import QRCode from "qrcode";

const DIGESTS = ["off", "daily", "weekly"];

// Own account (signed in) and password links (public).
export function accountRouter(db, auth, mailer, config, twoFactor) {
  const r = Router();
  const get = db.prepare("SELECT id, email, name, is_admin, digest FROM users WHERE id = ?");
  const limiter = rateLimit({ windowMs: 15 * 60e3, limit: config.loginLimit ?? 10, standardHeaders: "draft-8", legacyHeaders: false,
    message: { error: "För många försök. Vänta en kvart och försök igen." } });

  const view = id => ({ ...get.get(id), mail: mailer.enabled, totp: twoFactor.status(id) });
  const checkPassword = (req, res) => {
    const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.user.id);
    if (verifyPassword(String(req.body?.password || ""), row.password_hash)) return true;
    res.status(400).json({ error: "Lösenordet stämmer inte." });
    return false;
  };

  r.get("/account", requireUser, (req, res) => res.json(view(req.user.id)));

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
    res.json(view(req.user.id));
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

  // ---- two-step verification ----
  r.post("/account/totp/setup", requireUser, limiter, async (req, res) => {
    if (!checkPassword(req, res)) return;
    // Replacing a factor that is already on needs the same proof as turning it off.
    if (twoFactor.status(req.user.id).enabled && !twoFactor.check(req.user.id, req.body?.code))
      return res.status(400).json({ error: "Ange en kod från din app eller en reservkod för att byta app." });
    const secret = twoFactor.begin(req.user.id);
    const uri = otpauthUri(secret, req.user.email);
    const qr = await QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
    res.json({ secret, uri, qr });
  });

  r.post("/account/totp/confirm", requireUser, limiter, (req, res) => {
    const codes = twoFactor.confirm(req.user.id, req.body?.code);
    if (!codes) return res.status(400).json({ error: "Fel kod. Kontrollera att klockan i telefonen stämmer och försök igen." });
    auth.endOtherSessions(req, req.user.id);
    res.json({ recoveryCodes: codes, ...view(req.user.id) });
  });

  r.post("/account/totp/recovery", requireUser, limiter, (req, res) => {
    if (!checkPassword(req, res)) return;
    if (!twoFactor.status(req.user.id).enabled) return res.status(400).json({ error: "Tvåstegsverifiering är inte påslagen." });
    if (!twoFactor.check(req.user.id, req.body?.code)) return res.status(400).json({ error: "Fel kod." });
    res.json({ recoveryCodes: twoFactor.newRecoveryCodes(req.user.id), ...view(req.user.id) });
  });

  r.post("/account/totp/disable", requireUser, limiter, (req, res) => {
    if (!checkPassword(req, res)) return;
    if (!twoFactor.check(req.user.id, req.body?.code)) return res.status(400).json({ error: "Fel kod." });
    twoFactor.disable(req.user.id);
    res.json(view(req.user.id));
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
    // A reset link must not bypass two-step verification: those users log in normally afterwards.
    if (twoFactor.status(user.id).enabled) return res.json({ ok: true, login: true });
    auth.startSession(res, user.id);
    res.json({ ok: true });
  });

  return r;
}
