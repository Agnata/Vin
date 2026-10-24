// Sends e-mail digests to subscribers. Run once a day (see deploy/vinkallaren-digest.timer).
import { config } from "../server/config.js";
import { openDb } from "../server/db.js";
import { createMailer } from "../server/mailer.js";
import { sendDigests } from "../server/digest.js";

const db = openDb(config.dbPath);
const result = await sendDigests(db, createMailer(config.mail), config);
console.log(`Utskick: ${result.sent} skickade, ${result.skipped} utan nyheter, ${result.failed} misslyckade.`);
if (result.failed) process.exitCode = 1;
