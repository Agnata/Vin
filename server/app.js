import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as defaultConfig } from "./config.js";
import { openDb } from "./db.js";
import { createAuth, requireUser, requireAdmin, sameOriginJson } from "./auth.js";
import { createMailer } from "./mailer.js";
import { winesRouter } from "./routes/wines.js";
import { createPhotos } from "./photos.js";
import { accountRouter } from "./routes/account.js";
import { adminRouter } from "./routes/admin.js";
import { claudeRouter } from "./routes/claude.js";
import { health } from "./health.js";
import { startScheduler } from "./scheduler.js";
import { createTwoFactor } from "./twofactor.js";
import { statsRouter } from "./routes/stats.js";
import { drinksRouter } from "./routes/drinks.js";

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const page = name => path.join(PUBLIC, name);

const escHtml = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// Small server-rendered page for flows that must work without JavaScript (unsubscribe).
const simplePage = (title, body) => `<!doctype html><html lang="sv"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${escHtml(title)} · Vinkällaren</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="/css/style.css"></head>
<body><main class="login"><a href="/" style="font-style:italic;color:var(--muted);text-decoration:none">← vin.parnes.com</a>
<h1 style="font-size:clamp(40px,10vw,60px)">${escHtml(title)}</h1>${body}</main></body></html>`;

export function createApp(config = defaultConfig, db = openDb(config.dbPath), mailer = createMailer(config.mail)) {
  const app = express();
  const auth = createAuth(db, config);
  const twoFactor = createTwoFactor(db);
  const loginLimiter = rateLimit({ windowMs: 15 * 60e3, limit: config.loginLimit ?? 10, standardHeaders: "draft-8", legacyHeaders: false,
    message: { error: "För många försök. Vänta en kvart och försök igen." } });

  // Apache runs on the same machine and sets X-Forwarded-For/-Proto.
  app.set("trust proxy", "loopback");
  app.disable("x-powered-by");
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        "default-src": ["'self'"],
        "style-src": ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
        "font-src": ["https://fonts.gstatic.com"],
        "img-src": ["'self'", "data:", "blob:"],
        "upgrade-insecure-requests": config.production ? [] : null,
      },
    },
  }));
  // The session comes from the cookie alone, so it is known before any body is read.
  app.use(auth.middleware);
  // Photos are the only large request bodies, and only signed-in users may send them; everything else stays
  // small. Compressed bodies are refused (our client never sends them), so the limits count real bytes.
  if (config.claude.enabled) app.use("/api/claude/label", requireUser, express.json({ limit: "8mb", inflate: false }));
  app.use(/^\/api\/wines\/\d+\/photo$/, requireUser, express.json({ limit: "5mb", inflate: false }));
  app.use(express.json({ limit: "50kb", inflate: false }));
  // Signed-in pages and the API are never cached by browsers or proxies.
  app.use(["/api", "/kallaren", "/konto", "/statistik", "/admin", "/login", "/losenord"], (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use("/api", sameOriginJson(config));

  // ---- public ----
  app.get("/", (_req, res) => res.sendFile(page("index.html")));
  app.get("/login", (req, res) => (req.user ? res.redirect("/kallaren") : res.sendFile(page("login.html"))));

  app.get("/api/health", (_req, res) => {
    const h = health(db, config);
    res.status(h.ok ? 200 : 503).json(h);
  });

  app.get("/api/public", (_req, res) => {
    if (!config.publicStats) return res.json({});
    const s = db.prepare(`SELECT COALESCE(SUM(quantity),0) AS bottles, COUNT(DISTINCT country) AS countries,
                                 COUNT(DISTINCT producer) AS producers FROM wines WHERE quantity > 0`).get();
    const types = db.prepare("SELECT type, SUM(quantity) AS n FROM wines WHERE quantity > 0 GROUP BY type").all();
    res.json({ ...s, types: Object.fromEntries(types.map(t => [t.type, t.n])) });
  });

  app.post("/api/login", loginLimiter, (req, res) => {
    const user = auth.login(req.body?.email, req.body?.password);
    if (!user) return res.status(401).json({ error: "Fel e-post eller lösenord." });
    if (user.totp_enabled) return res.json({ totp_required: true, ticket: auth.createChallenge(user.id) });
    auth.startSession(res, user.id);
    res.json({ id: user.id, name: user.name, email: user.email });
  });
  // Second step: a code from the authenticator app, or a recovery code.
  app.post("/api/login/totp", loginLimiter, (req, res) => {
    const r = auth.completeChallenge(req.body?.ticket, req.body?.code, twoFactor);
    if (r.error) return res.status(r.expired ? 410 : 401).json({ error: r.error });
    auth.startSession(res, r.userId);
    res.json({ ok: true, recoveryLeft: r.how === "recovery" ? twoFactor.status(r.userId).recoveryLeft : undefined });
  });
  app.post("/api/logout", (req, res) => { auth.endSession(req, res); res.status(204).end(); });
  app.get("/api/me", (req, res) => res.json({ user: req.user, claude: config.claude.enabled }));
  app.get("/losenord", (_req, res) => res.sendFile(page("losenord.html")));
  app.use("/api", accountRouter(db, auth, mailer, config, twoFactor));

  // Unsubscribe from e-mail digests via the secret link in every digest. GET shows a confirm button;
  // POST (the button, or a mail client's one-click List-Unsubscribe) performs it.
  const byUnsub = db.prepare("SELECT id, name FROM users WHERE unsubscribe_token = ?");
  app.get("/avregistrera", (req, res) => {
    const user = req.query.t ? byUnsub.get(String(req.query.t)) : null;
    if (!user) return res.status(404).send(simplePage("Ogiltig länk", `<p class="lede">Länken fungerar inte längre. Logga in och ändra under <a href="/konto">Konto</a>.</p>`));
    res.send(simplePage("Avsluta prenumerationen", `<p class="lede">Vill du sluta få uppdateringar från Vinkällaren via e-post, ${escHtml(user.name)}?</p>
      <form method="post" action="/avregistrera?t=${encodeURIComponent(req.query.t)}"><button class="btn" type="submit">Ja, avsluta</button></form>`));
  });
  app.post("/avregistrera", express.urlencoded({ extended: false, limit: "1kb" }), (req, res) => {
    const user = req.query.t ? byUnsub.get(String(req.query.t)) : null;
    if (!user) return res.status(404).send(simplePage("Ogiltig länk", `<p class="lede">Länken fungerar inte längre.</p>`));
    db.prepare("UPDATE users SET digest = 'off' WHERE id = ?").run(user.id);
    res.send(simplePage("Klart", `<p class="lede">Du får inga fler uppdateringar via e-post. Du kan slå på dem igen under <a href="/konto">Konto</a>.</p>`));
  });

  // ---- signed in ----
  app.get("/kallaren", requireUser, (_req, res) => res.sendFile(page("kallaren.html")));
  app.get("/konto", requireUser, (_req, res) => res.sendFile(page("konto.html")));
  app.get("/statistik", requireUser, (_req, res) => res.sendFile(page("statistik.html")));
  app.use("/api/stats", requireUser, statsRouter(db));
  app.use("/api/drinks", requireUser, drinksRouter(db));
  app.get("/admin", requireAdmin, (_req, res) => res.sendFile(page("admin.html")));
  app.use("/api/admin", requireAdmin, adminRouter(db, auth, mailer, config, twoFactor));
  app.use("/api/wines", requireUser, winesRouter(db, createPhotos(config.photosDir)));
  if (config.claude.enabled) app.use("/api/claude", requireUser, claudeRouter(db, config));

  app.use(express.static(PUBLIC, { index: false, extensions: [], maxAge: config.production ? "1h" : 0 }));
  app.use("/api", (_req, res) => res.status(404).json({ error: "Finns inte." }));
  app.use((_req, res) => res.status(404).sendFile(page("404.html")));
  app.use((err, _req, res, _next) => {
    if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Ogiltig JSON." });
    if (err.type === "entity.too.large") return res.status(413).json({ error: "För stort." });
    if (err.type === "encoding.unsupported") return res.status(415).json({ error: "Komprimerade anrop stöds inte." });
    console.error(err);
    res.status(500).json({ error: "Något gick fel på servern." });
  });

  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const db = openDb(defaultConfig.dbPath);
  const mailer = createMailer(defaultConfig.mail);
  const app = createApp(defaultConfig, db, mailer);
  if (process.env.SCHEDULER !== "false") startScheduler(db, defaultConfig, mailer);
  app.listen(defaultConfig.port, defaultConfig.host, () =>
    console.log(`Vinkällaren lyssnar på http://${defaultConfig.host}:${defaultConfig.port}` +
      (defaultConfig.claude.enabled ? " (Claude på)" : "")));
}
