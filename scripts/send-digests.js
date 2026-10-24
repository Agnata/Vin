// Sends due e-mail digests right away (the service also does this every morning by itself).
import { config } from "../server/config.js";
import { openDb } from "../server/db.js";
import { createMailer } from "../server/mailer.js";
import { sendDigests } from "../server/digest.js";

const db = openDb(config.dbPath);
const result = await sendDigests(db, createMailer(config.mail), config);
console.log(`Utskick: ${result.sent} skickade, ${result.skipped} utan nyheter, ${result.failed} misslyckade.`);
if (result.failed) process.exitCode = 1;
