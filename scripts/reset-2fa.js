// Turns off two-step verification for a user who lost both phone and recovery codes,
// e.g. the only administrator. Signs the user out everywhere.
// Usage: npm run reset-2fa -- anna@example.com
import { config } from "../server/config.js";
import { openDb } from "../server/db.js";
import { createTwoFactor } from "../server/twofactor.js";

const email = process.argv[2];
const db = openDb(config.dbPath);
const user = email && db.prepare("SELECT id, email FROM users WHERE email = ?").get(email);
if (!user) {
  console.error("Användning: npm run reset-2fa -- e-post@exempel.se (användaren måste finnas)");
  process.exit(1);
}
createTwoFactor(db).disable(user.id);
db.prepare("DELETE FROM sessions WHERE user_id = ?").run(user.id);
console.log(`Tvåstegsverifiering avstängd för ${user.email}. Slå på den igen under Konto.`);
