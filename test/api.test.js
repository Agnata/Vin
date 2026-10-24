import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.js";
import { openDb } from "../server/db.js";
import { hashPassword } from "../server/auth.js";
import { createMailer } from "../server/mailer.js";
import { sendDigests } from "../server/digest.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "vk-test-"));
const config = { dbPath: ":memory:", production: false, origin: "", sessionDays: 1, publicStats: true, baseUrl: "https://vin.test",
  dataDir, backupDir: path.join(dataDir, "backups"), backupKeep: 2, offsiteTarget: "", mail: {}, claude: { enabled: false } };
let server, base, db, mailer, cookie = "";

before(async () => {
  db = openDb(":memory:");
  mailer = createMailer({});
  console.log = () => {}; // the unconfigured mailer logs every message
  db.prepare("INSERT INTO users (email, name, password_hash, is_admin) VALUES (?, ?, ?, 1)").run("a@example.se", "Anna", hashPassword("hemligt-losenord"));
  db.prepare("INSERT INTO wines (type, name, vintage, country, quantity) VALUES ('rott', 'Testvin', '2020', 'Italien', 2)").run();
  server = createApp(config, db, mailer).listen(0);
  await new Promise(r => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); fs.rmSync(dataDir, { recursive: true, force: true }); });

const call = (path, { method = "GET", body, headers = {} } = {}) => fetch(base + path, {
  method, redirect: "manual",
  headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
  body: body ? JSON.stringify(body) : undefined,
});

test("front page and stats are public, cellar is not", async () => {
  assert.equal((await call("/")).status, 200);
  assert.deepEqual(await (await call("/api/public")).json(), { bottles: 2, countries: 1, producers: 1, types: { rott: 2 } });
  assert.equal((await call("/api/wines")).status, 401);
  const page = await call("/kallaren");
  assert.equal(page.status, 302);
  assert.match(page.headers.get("location"), /^\/login/);
});

test("wrong password is rejected", async () => {
  const r = await call("/api/login", { method: "POST", body: { email: "a@example.se", password: "fel" } });
  assert.equal(r.status, 401);
});

test("login, list, add, drink, edit, delete", async () => {
  const r = await call("/api/login", { method: "POST", body: { email: "A@example.se", password: "hemligt-losenord" } });
  assert.equal(r.status, 200);
  cookie = r.headers.get("set-cookie").split(";")[0];
  assert.equal((await (await call("/api/me")).json()).user.name, "Anna");

  const wines = await (await call("/api/wines")).json();
  assert.equal(wines.length, 1);

  const added = await call("/api/wines", { method: "POST", body: { type: "vitt", name: "Nytt vitt", vintage: "2023", quantity: 1 } });
  assert.equal(added.status, 201);
  const w = await added.json();
  assert.equal(w.drink_from, 2024); // estimated
  assert.equal(w.taste_kind, "w");

  assert.equal((await call("/api/wines", { method: "POST", body: { type: "blått", name: "x" } })).status, 400);

  const drunk = await (await call(`/api/wines/${w.id}/drink`, { method: "POST", body: { note: "Gott" } })).json();
  assert.equal(drunk.quantity, 0);
  assert.equal((await (await call("/api/wines")).json()).length, 1, "empty wines are hidden");

  const edited = await (await call(`/api/wines/${wines[0].id}`, { method: "PATCH", body: { name: "Omdöpt", drink_to: null } })).json();
  assert.equal(edited.name, "Omdöpt");
  assert.equal(edited.drink_to, 2028);

  const hist = await (await call(`/api/wines/${w.id}/history`)).json();
  assert.deepEqual(hist.map(e => e.kind), ["drank", "added"]);
  assert.equal(hist[0].user, "Anna");

  assert.equal((await call(`/api/wines/${wines[0].id}`, { method: "DELETE" })).status, 204);
  assert.equal((await call(`/api/wines/${wines[0].id}`, { method: "DELETE" })).status, 404);
});

test("cross-site and non-JSON writes are blocked", async () => {
  const evil = await call("/api/wines", { method: "POST", body: { type: "rott", name: "x" }, headers: { Origin: "https://evil.example" } });
  assert.equal(evil.status, 403);
  const form = await fetch(base + "/api/wines", { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/x-www-form-urlencoded" }, body: "name=x" });
  assert.equal(form.status, 415);
});

test("CSV export", async () => {
  const r = await call("/api/wines/export.csv");
  assert.equal(r.status, 200);
  const bytes = new Uint8Array(await r.arrayBuffer());
  assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], "BOM so Excel reads UTF-8");
  assert.match(new TextDecoder().decode(bytes), /^id;type;name/);
});

const lastLink = () => mailer.sent.at(-1).text.match(/https:\/\/vin\.test\/losenord\?t=(\S+)/)[1];

test("admin invites a user who sets a password and signs in", async () => {
  const r = await call("/api/admin/users", { method: "POST", body: { name: "Bertil", email: "b@example.se" } });
  assert.equal(r.status, 201);
  const { user, link } = await r.json();
  assert.ok(link, "link returned when mail is not configured");
  assert.equal(mailer.sent.at(-1).to, "b@example.se");
  assert.equal((await call("/api/admin/users", { method: "POST", body: { name: "X", email: "B@example.se" } })).status, 409);

  const token = lastLink();
  const info = await (await call(`/api/password/token?t=${token}`)).json();
  assert.deepEqual([info.name, info.purpose], ["Bertil", "invite"]);
  assert.equal((await call("/api/password/set", { method: "POST", body: { token, password: "kort" } })).status, 400);

  const saved = cookie;
  const set = await call("/api/password/set", { method: "POST", body: { token, password: "bertils-losenord" } });
  assert.equal(set.status, 200);
  cookie = set.headers.get("set-cookie").split(";")[0];
  assert.equal((await (await call("/api/me")).json()).user.name, "Bertil");
  assert.equal((await call("/api/admin/users")).status, 403, "non-admin is blocked");
  assert.equal((await call("/admin")).status, 302);
  assert.equal((await call("/api/password/set", { method: "POST", body: { token, password: "bertils-losenord" } })).status, 400, "token is single-use");
  cookie = saved;

  const list = await (await call("/api/admin/users")).json();
  assert.equal(list.users.find(u => u.id === user.id).invited, 0);
});

test("admin guards: last admin, self", async () => {
  const { users } = await (await call("/api/admin/users")).json();
  const anna = users.find(u => u.name === "Anna"), bertil = users.find(u => u.name === "Bertil");
  assert.equal((await call(`/api/admin/users/${anna.id}`, { method: "PATCH", body: { is_admin: false } })).status, 400);
  assert.equal((await call(`/api/admin/users/${anna.id}`, { method: "DELETE" })).status, 400);
  const promoted = await (await call(`/api/admin/users/${bertil.id}`, { method: "PATCH", body: { is_admin: true, name: "Bertil B" } })).json();
  assert.deepEqual([promoted.is_admin, promoted.name], [1, "Bertil B"]);
  const link = await (await call(`/api/admin/users/${bertil.id}/link`, { method: "POST", body: {} })).json();
  assert.equal(link.purpose, "reset", "user who has signed in gets a reset link");
});

test("forgot password sends a reset link without revealing accounts", async () => {
  const before = mailer.sent.length;
  assert.equal((await call("/api/password/forgot", { method: "POST", body: { email: "finns-inte@example.se" } })).status, 200);
  assert.equal(mailer.sent.length, before);
  assert.equal((await call("/api/password/forgot", { method: "POST", body: { email: "a@example.se" } })).status, 200);
  assert.match(mailer.sent.at(-1).subject, /lösenord/);
  assert.equal((await (await call(`/api/password/token?t=${lastLink()}`)).json()).purpose, "reset");
});

test("account: change name, password, subscription", async () => {
  const a = await (await call("/api/account", { method: "PATCH", body: { name: "Anna A", digest: "daily" } })).json();
  assert.deepEqual([a.name, a.digest], ["Anna A", "daily"]);
  assert.equal((await call("/api/account", { method: "PATCH", body: { digest: "hourly" } })).status, 400);
  assert.equal((await call("/api/account/password", { method: "POST", body: { current: "fel", password: "nytt-losenord-1" } })).status, 400);
  assert.equal((await call("/api/account/password", { method: "POST", body: { current: "hemligt-losenord", password: "nytt-losenord-1" } })).status, 200);
  assert.equal((await call("/api/me")).status, 200, "current session survives a password change");
});

test("daily digest and unsubscribe", async () => {
  // Nothing happened since subscribing -> nothing sent.
  let r = await sendDigests(db, mailer, config);
  assert.deepEqual([r.sent, r.skipped], [0, 1]);

  db.prepare("UPDATE users SET digest_sent_at = datetime('now', '-1 hour') WHERE email = 'a@example.se'").run();
  await call("/api/wines", { method: "POST", body: { type: "bubbel", name: "Digest-bubbel", vintage: "2018" } });
  r = await sendDigests(db, mailer, config);
  assert.equal(r.sent, 1);
  const mail = mailer.sent.at(-1);
  assert.equal(mail.to, "a@example.se");
  assert.match(mail.text, /Digest-bubbel 2018 lades in av Anna A/);
  const unsub = mail.headers["List-Unsubscribe"].slice(1, -1).replace("https://vin.test", "");
  assert.equal((await sendDigests(db, mailer, config)).sent, 0, "not sent twice");

  assert.equal((await fetch(base + unsub)).status, 200);
  const done = await fetch(base + unsub, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" });
  assert.equal(done.status, 200);
  assert.equal(db.prepare("SELECT digest FROM users WHERE email = 'a@example.se'").get().digest, "off");
  assert.equal((await fetch(base + "/avregistrera?t=fel")).status, 404);
});

test("weekly digest goes out on Mondays with drink-soon reminders", async () => {
  db.prepare("UPDATE users SET digest = 'weekly', digest_sent_at = datetime('now') WHERE email = 'a@example.se'").run();
  db.prepare("INSERT INTO wines (type, name, vintage, quantity, drink_to) VALUES ('vitt', 'Gammalt vitt', '2015', 1, 2019)").run();
  const tuesday = new Date("2026-10-27T07:00:00"), monday = new Date("2026-10-26T07:00:00");
  assert.equal((await sendDigests(db, mailer, config, tuesday)).sent, 0);
  assert.equal((await sendDigests(db, mailer, config, monday)).sent, 1);
  assert.match(mailer.sent.at(-1).text, /Bör drickas snart:[\s\S]*Gammalt vitt 2015/);
});

test("health, backups and admin system view", async () => {
  let h = await call("/api/health");
  assert.equal(h.status, 503, "no backup yet");
  assert.equal((await h.json()).checks.backup.ok, false);

  for (let i = 0; i < 3; i++) {
    const r = await call("/api/admin/backups", { method: "POST", body: {} });
    assert.equal(r.status, 201);
    await new Promise(res => setTimeout(res, 1100)); // names have one-second resolution
  }
  const sys = await (await call("/api/admin/system")).json();
  assert.equal(sys.backups.length, 2, "pruned to backupKeep");
  assert.equal(sys.offsite, null);
  assert.ok(!fs.readdirSync(config.backupDir).some(n => n.endsWith(".partial")));

  h = await call("/api/health");
  const body = await h.json();
  assert.equal(h.status, 200, JSON.stringify(body));
  assert.deepEqual(body.checks.offsite, { ok: true, status: "off" });

  const dl = await call(`/api/admin/backups/${sys.backups[0].name}/download`);
  assert.equal(dl.status, 200);
  const bytes = Buffer.from(await dl.arrayBuffer());
  assert.equal(bytes.subarray(0, 15).toString(), "SQLite format 3");
  assert.equal((await call("/api/admin/backups/..%2Fetc/download")).status, 404);
});

test("offsite status feeds health", async () => {
  const cfg = { ...config, offsiteTarget: "backup@nas:/srv/vin" };
  const { health } = await import("../server/health.js");
  assert.equal(health(db, cfg).checks.offsite.ok, false);
  fs.writeFileSync(path.join(config.backupDir, "offsite.json"), JSON.stringify({ ok: true, lastSuccess: new Date().toISOString() }));
  assert.equal(health(db, cfg).checks.offsite.ok, true);
});

test("scheduler: backup at night, digest in the morning, Swedish time", async () => {
  const { startScheduler } = await import("../server/scheduler.js");
  const { getMeta } = await import("../server/db.js");
  const cfg = { ...config, backupDir: path.join(dataDir, "sched") };
  const s = startScheduler(db, cfg, mailer);
  await s.tick(new Date("2026-11-02T00:30:00Z")); // 01:30 in Stockholm: first backup ever -> runs
  assert.equal(fs.readdirSync(cfg.backupDir).length, 1);
  await s.tick(new Date("2026-11-02T01:30:00Z")); // 02:30: same day, already done
  assert.equal(fs.readdirSync(cfg.backupDir).length, 1);
  await s.tick(new Date("2026-11-03T01:30:00Z")); // next day 02:30: before 03:00
  assert.equal(fs.readdirSync(cfg.backupDir).length, 1);
  await s.tick(new Date("2026-11-03T02:05:00Z")); // 03:05
  assert.equal(fs.readdirSync(cfg.backupDir).length, 2);
  assert.notEqual(getMeta(db, "digest_date"), "2026-11-03");
  await s.tick(new Date("2026-11-03T06:05:00Z")); // 07:05 -> digests run once
  assert.equal(getMeta(db, "digest_date"), "2026-11-03");
});

test("logout ends the session", async () => {
  assert.equal((await call("/api/logout", { method: "POST", body: {} })).status, 204);
  assert.equal((await call("/api/wines")).status, 401);
});
