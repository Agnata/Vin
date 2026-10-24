// All settings come from environment variables (see deploy/vinkallaren.env.example).
const env = process.env;

export const config = {
  port: Number(env.PORT || 3000),
  host: env.HOST || "127.0.0.1",
  dbPath: env.DB_PATH || "./vin.db",
  production: env.NODE_ENV === "production",
  // Public origin, used to reject cross-site writes. Empty = accept same host only.
  origin: env.PUBLIC_ORIGIN || "",
  sessionDays: Number(env.SESSION_DAYS || 30),
  // Show aggregate numbers (bottles, countries) on the public front page.
  publicStats: env.PUBLIC_STATS !== "false",
  // Absolute base URL used in e-mail links.
  baseUrl: (env.PUBLIC_ORIGIN || `http://127.0.0.1:${env.PORT || 3000}`).replace(/\/$/, ""),
  mail: {
    from: env.MAIL_FROM || "Vinkällaren <vin@parnes.com>",
    // Without SMTP_HOST, mail is logged to the console instead of sent.
    smtp: env.SMTP_HOST ? {
      host: env.SMTP_HOST,
      port: Number(env.SMTP_PORT || 587),
      secure: env.SMTP_SECURE === "true",
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
      // A local postfix on the same machine is reached without TLS.
      ignoreTLS: ["localhost", "127.0.0.1"].includes(env.SMTP_HOST),
    } : null,
  },
  claude: {
    enabled: env.CLAUDE_ENABLED === "true" && !!env.ANTHROPIC_API_KEY,
    model: env.CLAUDE_MODEL || "claude-opus-5-5",
  },
};
