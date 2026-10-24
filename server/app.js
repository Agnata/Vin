import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as defaultConfig } from "./config.js";
import { openDb } from "./db.js";
import { createAuth, requireUser, sameOriginJson } from "./auth.js";
import { winesRouter } from "./routes/wines.js";
import { claudeRouter } from "./routes/claude.js";

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
const page = name => path.join(PUBLIC, name);

export function createApp(config = defaultConfig, db = openDb(config.dbPath)) {
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
  app.use(auth.middleware);
  app.use("/api", sameOriginJson(config));

  // ---- public ----
  app.get("/", (_req, res) => res.sendFile(page("index.html")));
  app.get("/login", (req, res) => (req.user ? res.redirect("/kallaren") : res.sendFile(page("login.html"))));

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

  // ---- signed in ----
  app.get("/kallaren", requireUser, (_req, res) => res.sendFile(page("kallaren.html")));
  app.use("/api/wines", requireUser, winesRouter(db));
  if (config.claude.enabled) app.use("/api/claude", requireUser, claudeRouter(db, config));

  app.use(express.static(PUBLIC, { index: false, maxAge: config.production ? "1h" : 0 }));
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
  const app = createApp();
  app.listen(defaultConfig.port, defaultConfig.host, () =>
    console.log(`Vinkällaren lyssnar på http://${defaultConfig.host}:${defaultConfig.port}` +
      (defaultConfig.claude.enabled ? " (Claude på)" : "")));
}
