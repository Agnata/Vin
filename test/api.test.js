import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../server/app.js";
import { openDb } from "../server/db.js";
import { hashPassword } from "../server/auth.js";

const config = { dbPath: ":memory:", production: false, origin: "", sessionDays: 1, publicStats: true, claude: { enabled: false } };
let server, base, cookie = "";

before(async () => {
  const db = openDb(":memory:");
  db.prepare("INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)").run("a@example.se", "Anna", hashPassword("hemligt-losen"));
  db.prepare("INSERT INTO wines (type, name, vintage, country, quantity) VALUES ('rott', 'Testvin', '2020', 'Italien', 2)").run();
  server = createApp(config, db).listen(0);
  await new Promise(r => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

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
  const r = await call("/api/login", { method: "POST", body: { email: "A@example.se", password: "hemligt-losen" } });
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

test("logout ends the session", async () => {
  assert.equal((await call("/api/logout", { method: "POST", body: {} })).status, 204);
  assert.equal((await call("/api/wines")).status, 401);
});
