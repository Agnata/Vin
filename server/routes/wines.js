import { Router } from "express";
import { estimate } from "../estimate.js";

const TYPES = ["rott", "vitt", "rose", "bubbel", "orange"];
const TEXT = ["name", "producer", "grapes", "vintage", "country", "region", "style", "note"];
const INTS = ["drink_from", "drink_to", "taste1", "taste2", "taste3"];

// Returns [cleanFields, error]. With partial=true, only the given fields are checked.
export function validateWine(body, partial = false) {
  const out = {};
  if (!body || typeof body !== "object") return [null, "Ogiltig data."];
  if (!partial || "type" in body) {
    if (!TYPES.includes(body.type)) return [null, "Okänd vintyp."];
    out.type = body.type;
  }
  if (!partial || "name" in body) {
    const name = String(body.name ?? "").trim();
    if (!name) return [null, "Vinet behöver ett namn."];
    if (name.length > 200) return [null, "Namnet är för långt."];
    out.name = name;
  }
  for (const k of TEXT) {
    if (k === "name" || !(k in body)) continue;
    const v = String(body[k] ?? "").trim();
    if (v.length > (k === "note" ? 2000 : 200)) return [null, `Fältet ${k} är för långt.`];
    out[k] = v;
  }
  if ("vintage" in out && out.vintage && !/^\d{4}$/.test(out.vintage)) return [null, "Årgången ska vara fyra siffror."];
  if ("quantity" in body) {
    const n = Number(body.quantity);
    if (!Number.isInteger(n) || n < 0 || n > 999) return [null, "Antalet ska vara ett heltal 0–999."];
    out.quantity = n;
  }
  if ("opened" in body) out.opened = body.opened ? 1 : 0;
  for (const k of INTS) {
    if (!(k in body)) continue;
    if (body[k] === null || body[k] === "") { out[k] = null; continue; }
    const n = Number(body[k]);
    const ok = k.startsWith("taste") ? n >= 1 && n <= 12 : n >= 1900 && n <= 2200;
    if (!Number.isInteger(n) || !ok) return [null, `Ogiltigt värde för ${k}.`];
    out[k] = n;
  }
  if ("taste_kind" in body) {
    if (!["r", "w", null].includes(body.taste_kind)) return [null, "Ogiltig smaktyp."];
    out.taste_kind = body.taste_kind;
  }
  return [out, null];
}

export function winesRouter(db) {
  const r = Router();
  const q = {
    list: db.prepare("SELECT * FROM wines WHERE quantity > 0 ORDER BY id"),
    get: db.prepare("SELECT * FROM wines WHERE id = ?"),
    event: db.prepare("INSERT INTO events (wine_id, user_id, kind, detail) VALUES (?, ?, ?, ?)"),
    history: db.prepare(`SELECT e.kind, e.detail, e.created_at, u.name AS user FROM events e
                         LEFT JOIN users u ON u.id = e.user_id WHERE e.wine_id = ? ORDER BY e.id DESC LIMIT 50`),
    remove: db.prepare("DELETE FROM wines WHERE id = ?"),
  };
  const log = (wineId, req, kind, detail = "") => q.event.run(wineId, req.user?.id ?? null, kind, detail);

  const load = (req, res, next) => {
    const wine = q.get.get(Number(req.params.id));
    if (!wine) return res.status(404).json({ error: "Vinet finns inte." });
    req.wine = wine;
    next();
  };

  r.get("/", (_req, res) => res.json(q.list.all()));

  r.post("/", (req, res) => {
    const [fields, err] = validateWine(req.body);
    if (err) return res.status(400).json({ error: err });
    const row = { quantity: 1, opened: 0, ...fields, ...estimate(fields) };
    const cols = Object.keys(row);
    const info = db.prepare(`INSERT INTO wines (${cols.join(",")}) VALUES (${cols.map(c => "@" + c).join(",")})`).run(row);
    log(info.lastInsertRowid, req, "added", `${row.quantity} st`);
    res.status(201).json(q.get.get(info.lastInsertRowid));
  });

  r.patch("/:id", load, (req, res) => {
    const [fields, err] = validateWine(req.body, true);
    if (err) return res.status(400).json({ error: err });
    // Fields cleared in the form fall back to an estimate, as for new wines.
    const est = estimate({ ...req.wine, ...fields });
    for (const k of Object.keys(est)) if (k in fields && fields[k] === null) fields[k] = est[k];
    const cols = Object.keys(fields);
    if (!cols.length) return res.json(req.wine);
    db.prepare(`UPDATE wines SET ${cols.map(c => `${c} = @${c}`).join(", ")}, updated_at = datetime('now') WHERE id = @id`)
      .run({ ...fields, id: req.wine.id });
    log(req.wine.id, req, "edited", cols.join(", "));
    res.json(q.get.get(req.wine.id));
  });

  // Drink one bottle: decrement quantity and clear "opened".
  r.post("/:id/drink", load, (req, res) => {
    if (req.wine.quantity < 1) return res.status(409).json({ error: "Det finns inga flaskor kvar." });
    db.prepare("UPDATE wines SET quantity = quantity - 1, opened = 0, updated_at = datetime('now') WHERE id = ?").run(req.wine.id);
    log(req.wine.id, req, "drank", String(req.body?.note || "").slice(0, 500));
    res.json(q.get.get(req.wine.id));
  });

  r.post("/:id/open", load, (req, res) => {
    const opened = req.body?.opened === false ? 0 : 1;
    db.prepare("UPDATE wines SET opened = ?, updated_at = datetime('now') WHERE id = ?").run(opened, req.wine.id);
    log(req.wine.id, req, opened ? "opened" : "closed");
    res.json(q.get.get(req.wine.id));
  });

  r.get("/:id/history", load, (req, res) => res.json(q.history.all(req.wine.id)));

  r.delete("/:id", load, (req, res) => {
    log(req.wine.id, req, "deleted", req.wine.name);
    q.remove.run(req.wine.id);
    res.status(204).end();
  });

  return r;
}
