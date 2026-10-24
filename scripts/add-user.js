// Creates a user, or sets a new password for an existing one.
// Usage: npm run add-user -- anna@example.com "Anna" [--admin]
// The first administrator is created this way; after that, use the Admin page.
import readline from "node:readline";
import { config } from "../server/config.js";
import { openDb } from "../server/db.js";
import { hashPassword, passwordProblem } from "../server/auth.js";

const admin = process.argv.includes("--admin");
const [email, name] = process.argv.slice(2).filter(a => a !== "--admin");
if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
  console.error('Användning: npm run add-user -- e-post@exempel.se "Namn" [--admin]');
  process.exit(1);
}

function askHidden(prompt) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = s => rl.output.write(s.startsWith(prompt) ? s : "");
    rl.question(prompt, answer => { rl.close(); process.stdout.write("\n"); resolve(answer); });
  });
}

const password = process.env.VK_PASSWORD || await askHidden("Lösenord (minst 10 tecken): ");
if (passwordProblem(password)) {
  console.error(passwordProblem(password));
  process.exit(1);
}

const db = openDb(config.dbPath);
const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
if (existing) {
  db.prepare("UPDATE users SET password_hash = ?, name = COALESCE(?, name), is_admin = MAX(is_admin, ?) WHERE id = ?")
    .run(hashPassword(password), name || null, admin ? 1 : 0, existing.id);
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(existing.id);
  console.log(`Nytt lösenord satt för ${email}. Användarens sessioner är utloggade.`);
} else {
  db.prepare("INSERT INTO users (email, name, password_hash, is_admin) VALUES (?, ?, ?, ?)")
    .run(email, name || email.split("@")[0], hashPassword(password), admin ? 1 : 0);
  console.log(`Skapade ${admin ? "administratören" : "användaren"} ${email}.`);
}
