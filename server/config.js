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
  claude: {
    enabled: env.CLAUDE_ENABLED === "true" && !!env.ANTHROPIC_API_KEY,
    model: env.CLAUDE_MODEL || "claude-opus-5-5",
  },
};
