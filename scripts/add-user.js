// Creates a user, or sets a new password for an existing one.
// Usage: npm run add-user -- anna@example.com "Anna"
import readline from "node:readline";
import { config } from "../server/config.js";
import { openDb } from "../server/db.js";
import { hashPassword } from "../server/auth.js";

const [email, name] = process.argv.slice(2);
if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
  console.error('Användning: npm run add-user -- e-post@exempel.se "Namn"');
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
if (password.length < 10) {
  console.error("Lösenordet måste vara minst 10 tecken.");
  process.exit(1);
}

const db = openDb(config.dbPath);
const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
if (existing) {
  db.prepare("UPDATE users SET password_hash = ?, name = COALESCE(?, name) WHERE id = ?").run(hashPassword(password), name || null, existing.id);
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(existing.id);
  console.log(`Nytt lösenord satt för ${email}. Användarens sessioner är utloggade.`);
} else {
  db.prepare("INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)").run(email, name || email.split("@")[0], hashPassword(password));
  console.log(`Skapade användaren ${email}.`);
}
