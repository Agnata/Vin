import { Router } from "express";
import { ratingProblem } from "./wines.js";

// Drunk bottles: one 'drank' event each, with an optional score and note.
export function drinksRouter(db) {
  const r = Router();
  const q = {
    list: db.prepare(`SELECT e.id, e.created_at, e.detail AS note, e.rating, e.wine_id, u.name AS user,
        w.name, w.producer, w.vintage, w.type, w.country, w.region, w.photo, w.quantity
      FROM events e LEFT JOIN wines w ON w.id = e.wine_id LEFT JOIN users u ON u.id = e.user_id
      WHERE e.kind = 'drank' ORDER BY e.created_at DESC, e.id DESC LIMIT 1000`),
    get: db.prepare("SELECT * FROM events WHERE id = ? AND kind = 'drank'"),
    one: db.prepare(`SELECT e.id, e.created_at, e.detail AS note, e.rating, e.wine_id, u.name AS user,
        w.name, w.producer, w.vintage, w.type, w.country, w.region, w.photo, w.quantity
      FROM events e LEFT JOIN wines w ON w.id = e.wine_id LEFT JOIN users u ON u.id = e.user_id WHERE e.id = ?`),
  };
  const load = (req, res, next) => {
    req.drink = q.get.get(Number(req.params.id));
    if (!req.drink) return res.status(404).json({ error: "Flaskan finns inte i historiken." });
    next();
  };

  r.get("/", (_req, res) => res.json(q.list.all()));

  // Set or change score and note afterwards. rating null removes the score.
  r.patch("/:id", load, (req, res) => {
    const fields = {};
    if ("rating" in (req.body || {})) {
      if (ratingProblem(req.body.rating)) return res.status(400).json({ error: ratingProblem(req.body.rating) });
      fields.rating = req.body.rating;
    }
    if ("note" in (req.body || {})) fields.detail = String(req.body.note || "").trim().slice(0, 500);
    const cols = Object.keys(fields);
    if (cols.length) db.prepare(`UPDATE events SET ${cols.map(c => `${c} = @${c}`).join(", ")} WHERE id = @id`).run({ ...fields, id: req.drink.id });
    res.json(q.one.get(req.drink.id));
  });

  // Undo a "Drack en" pressed by mistake: the bottle goes back into the cellar.
  r.delete("/:id", load, (req, res) => {
    db.prepare("UPDATE wines SET quantity = quantity + 1, updated_at = datetime('now') WHERE id = ?").run(req.drink.wine_id);
    db.prepare("DELETE FROM events WHERE id = ?").run(req.drink.id);
    res.status(204).end();
  });

  return r;
}
