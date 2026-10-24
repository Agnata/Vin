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
import { accountRouter } from "./routes/account.js";
import { adminRouter } from "./routes/admin.js";
import { claudeRouter } from "./routes/claude.js";
import { health } from "./health.js";
import { startScheduler } from "./scheduler.js";

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

  // Apache runs on the same machine and sets X-Forwarded-For/-Proto.
  app.set("trust proxy", "loopback");
  app.disable("x-powered-by");
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        "default-src": ["'self'"],
        "style-src": ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
        "font-src": ["https://fonts.gstatic.com"],
        "img-src": ["'self'", "data:"],
        "upgrade-insecure-requests": config.production ? [] : null,
      },
    },
  }));
  app.use(express.json({ limit: "50kb" }));
  // Signed-in pages and the API are never cached by browsers or proxies.
  app.use(["/api", "/kallaren", "/konto", "/admin", "/login", "/losenord"], (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });
  app.use(auth.middleware);
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

  app.post("/api/login", rateLimit({ windowMs: 15 * 60e3, limit: 10, standardHeaders: "draft-8", legacyHeaders: false,
    message: { error: "För många försök. Vänta en kvart och försök igen." } }), (req, res) => {
    const user = auth.login(req.body?.email, req.body?.password);
    if (!user) return res.status(401).json({ error: "Fel e-post eller lösenord." });
    auth.startSession(res, user.id);
    res.json({ id: user.id, name: user.name, email: user.email });
  });
  app.post("/api/logout", (req, res) => { auth.endSession(req, res); res.status(204).end(); });
  app.get("/api/me", (req, res) => res.json({ user: req.user, claude: config.claude.enabled }));
  app.get("/losenord", (_req, res) => res.sendFile(page("losenord.html")));
  app.use("/api", accountRouter(db, auth, mailer, config));

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
  app.get("/admin", requireAdmin, (_req, res) => res.sendFile(page("admin.html")));
  app.use("/api/admin", requireAdmin, adminRouter(db, auth, mailer, config));
  app.use("/api/wines", requireUser, winesRouter(db));
  if (config.claude.enabled) app.use("/api/claude", requireUser, claudeRouter(db, config));

  app.use(express.static(PUBLIC, { index: false, extensions: [], maxAge: config.production ? "1h" : 0 }));
  app.use("/api", (_req, res) => res.status(404).json({ error: "Finns inte." }));
  app.use((_req, res) => res.status(404).sendFile(page("404.html")));
  app.use((err, _req, res, _next) => {
    if (err.type === "entity.parse.failed") return res.status(400).json({ error: "Ogiltig JSON." });
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
