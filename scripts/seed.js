// Loads data/wines-seed.json into an empty database.
// Usage: npm run seed            (refuses if wines already exist)
//        npm run seed -- --force (clears wines and history first)
import fs from "node:fs";
import { config } from "../server/config.js";
import { openDb } from "../server/db.js";

const db = openDb(config.dbPath);
const force = process.argv.includes("--force");
const count = db.prepare("SELECT COUNT(*) AS n FROM wines").get().n;
if (count && !force) {
  console.error(`Databasen har redan ${count} viner. Kör med --force för att ersätta dem.`);
  process.exit(1);
}

const seed = JSON.parse(fs.readFileSync(new URL("../data/wines-seed.json", import.meta.url), "utf8"));
const insert = db.prepare(`INSERT INTO wines (type, name, producer, grapes, vintage, country, region, style, quantity, opened,
  drink_from, drink_to, taste_kind, taste1, taste2, taste3)
  VALUES (@t, @n, @p, @g, @v, @c, @r, @s, @q, @o, @f, @u, @k, @t1, @t2, @t3)`);
const event = db.prepare("INSERT INTO events (wine_id, kind, detail) VALUES (?, 'added', 'import')");

db.transaction(() => {
  if (force) db.exec("DELETE FROM events; DELETE FROM wines;");
  for (const w of seed) {
    const [t1, t2, t3] = w.tk?.v ?? [];
    const info = insert.run({ ...w, o: w.o ? 1 : 0, k: w.tk?.k ?? null, t1, t2, t3 });
    event.run(info.lastInsertRowid);
  }
})();
console.log(`Importerade ${seed.length} viner (${seed.reduce((a, w) => a + w.q, 0)} flaskor) till ${config.dbPath}.`);
