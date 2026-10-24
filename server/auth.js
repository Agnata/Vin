import crypto from "node:crypto";
import { transaction } from "./db.js";

const COOKIE = "vk_sess";
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64, SCRYPT);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

export function verifyPassword(password, stored) {
  const [alg, salt, key] = String(stored).split("$");
  if (alg !== "scrypt" || !salt || !key) return false;
  const expected = Buffer.from(key, "base64");
  const actual = crypto.scryptSync(password, Buffer.from(salt, "base64"), expected.length, SCRYPT);
  return crypto.timingSafeEqual(actual, expected);
}

// Compared against when the e-mail is unknown, so response time does not reveal which accounts exist.
const DUMMY_HASH = hashPassword(crypto.randomBytes(16).toString("hex"));

const sha256 = s => crypto.createHash("sha256").update(s).digest("hex");

function readCookie(req, name) {
  for (const part of (req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function createAuth(db, config) {
  const q = {
    userByEmail: db.prepare("SELECT * FROM users WHERE email = ?"),
    insertSession: db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)"),
    sessionUser: db.prepare(`SELECT u.id, u.email, u.name, u.is_admin FROM sessions s JOIN users u ON u.id = s.user_id
                             WHERE s.token_hash = ? AND s.expires_at > datetime('now')`),
    deleteSession: db.prepare("DELETE FROM sessions WHERE token_hash = ?"),
    purge: db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')"),
    touch: db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?"),
    otherSessions: db.prepare("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?"),
    insertToken: db.prepare("INSERT INTO password_tokens (token_hash, user_id, purpose, expires_at) VALUES (?, ?, ?, ?)"),
    clearTokens: db.prepare("DELETE FROM password_tokens WHERE user_id = ? OR expires_at <= datetime('now')"),
    findToken: db.prepare(`SELECT t.purpose, u.id, u.name, u.email FROM password_tokens t JOIN users u ON u.id = t.user_id
                           WHERE t.token_hash = ? AND t.expires_at > datetime('now')`),
    setPassword: db.prepare("UPDATE users SET password_hash = ? WHERE id = ?"),
  };
  const sqlTime = d => d.toISOString().replace("T", " ").slice(0, 19);

  const cookieOpts = maxAge =>
    [`Path=/`, `HttpOnly`, `SameSite=Lax`, `Max-Age=${maxAge}`, config.cookieSecure ? "Secure" : ""].filter(Boolean).join("; ");

  return {
    login(email, password) {
      const user = q.userByEmail.get(String(email || "").trim());
      const ok = verifyPassword(String(password || ""), user ? user.password_hash : DUMMY_HASH);
      return ok && user ? user : null;
    },
    startSession(res, userId) {
      q.purge.run();
      const token = crypto.randomBytes(32).toString("base64url");
      const expires = new Date(Date.now() + config.sessionDays * 864e5);
      q.insertSession.run(sha256(token), userId, sqlTime(expires));
      q.touch.run(userId);
      res.setHeader("Set-Cookie", `${COOKIE}=${token}; ${cookieOpts(config.sessionDays * 86400)}`);
    },
    endSession(req, res) {
      const token = readCookie(req, COOKIE);
      if (token) q.deleteSession.run(sha256(token));
      res.setHeader("Set-Cookie", `${COOKIE}=; ${cookieOpts(0)}`);
    },
    // Signs out the user everywhere except the current browser.
    endOtherSessions(req, userId) {
      q.otherSessions.run(userId, sha256(readCookie(req, COOKIE) || ""));
    },
    // One-time links for invitations (7 days) and password resets (2 hours).
    createPasswordToken(userId, purpose) {
      q.clearTokens.run(userId);
      const token = crypto.randomBytes(32).toString("base64url");
      const hours = purpose === "invite" ? 24 * 7 : 2;
      q.insertToken.run(sha256(token), userId, purpose, sqlTime(new Date(Date.now() + hours * 36e5)));
      return token;
    },
    findPasswordToken(token) {
      return token ? q.findToken.get(sha256(String(token))) || null : null;
    },
    // Sets the password from a token; returns the user or null.
    usePasswordToken(token, password) {
      const found = this.findPasswordToken(token);
      if (!found) return null;
      transaction(db, () => {
        q.setPassword.run(hashPassword(password), found.id);
        q.clearTokens.run(found.id);
        db.prepare("DELETE FROM sessions WHERE user_id = ?").run(found.id);
      });
      return found;
    },
    // Attaches req.user when a valid session cookie is present.
    middleware(req, _res, next) {
      const token = readCookie(req, COOKIE);
      req.user = token ? q.sessionUser.get(sha256(token)) || null : null;
      next();
    },
  };
}

export function requireUser(req, res, next) {
  if (req.user) return next();
  if (req.originalUrl.startsWith("/api/")) return res.status(401).json({ error: "Du behöver logga in." });
  res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
}

export function requireAdmin(req, res, next) {
  if (req.user?.is_admin) return next();
  if (req.originalUrl.startsWith("/api/")) return res.status(req.user ? 403 : 401).json({ error: "Kräver administratör." });
  res.redirect(req.user ? "/kallaren" : `/login?next=${encodeURIComponent(req.originalUrl)}`);
}

export const MIN_PASSWORD = 12;
export function passwordProblem(pw) {
  if (typeof pw !== "string" || pw.length < MIN_PASSWORD) return `Lösenordet måste vara minst ${MIN_PASSWORD} tecken.`;
  if (pw.length > 200) return "Lösenordet är för långt.";
  return null;
}

// Writes must be JSON from our own origin: blocks cross-site form posts (CSRF).
export function sameOriginJson(config) {
  return (req, res, next) => {
    if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
    // Body-less requests (e.g. DELETE) carry no Content-Type; anything else must be JSON.
    const hasBody = req.headers["content-type"] || Number(req.headers["content-length"] || 0) > 0 || req.headers["transfer-encoding"];
    if (hasBody && !req.is("application/json")) return res.status(415).json({ error: "Förväntade JSON." });
    const origin = req.headers.origin;
    if (origin) {
      const allowed = config.origin || `${req.protocol}://${req.headers.host}`;
      if (origin !== allowed) return res.status(403).json({ error: "Fel ursprung." });
    }
    next();
  };
}
