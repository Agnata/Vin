import { Router } from "express";
import { stockholm } from "../clock.js";

// Figures for the Statistics page: what is in the cellar now and what happened the last 12 months.
export function statsRouter(db) {
  const r = Router();

  r.get("/", (_req, res) => {
    const now = stockholm();
    const [y, m] = now.date.split("-").map(Number);
    const months = Array.from({ length: 12 }, (_, i) => {
      const d = new Date(Date.UTC(y, m - 12 + i, 1));
      return d.toISOString().slice(0, 7);
    });
    const since = `${months[0]}-01`;

    const cellar = db.prepare(`SELECT COALESCE(SUM(quantity),0) AS bottles, COUNT(*) AS wines,
      COALESCE(SUM(CASE WHEN drink_to IS NOT NULL AND drink_to <= ? THEN quantity END),0) AS drinkSoon
      FROM wines WHERE quantity > 0`).get(y);

    // Every drink event with what we know about the wine at the time of the query.
    const drank = db.prepare(`SELECT substr(e.created_at,1,7) AS month, CAST(substr(e.created_at,1,4) AS INTEGER) AS year,
        w.type, w.country, w.drink_from, w.drink_to, u.name AS user
      FROM events e LEFT JOIN wines w ON w.id = e.wine_id LEFT JOIN users u ON u.id = e.user_id
      WHERE e.kind = 'drank' AND e.created_at >= ?`).all(since);
    const added = db.prepare(`SELECT substr(created_at,1,7) AS month, COUNT(*) AS n FROM events
      WHERE kind = 'added' AND detail != 'import' AND created_at >= ? GROUP BY month`).all(since);

    const count = (rows, key) => {
      const m = new Map();
      for (const row of rows) { const k = key(row); if (k) m.set(k, (m.get(k) || 0) + 1); }
      return [...m].map(([label, n]) => ({ label, n })).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label, "sv"));
    };
    const byMonth = new Map(count(drank, d => d.month).map(x => [x.label, x.n]));
    const addedByMonth = new Map(added.map(a => [a.month, a.n]));

    const window = { early: 0, inside: 0, late: 0, unknown: 0 };
    for (const d of drank) {
      if (!d.drink_from || !d.drink_to) window.unknown++;
      else if (d.year < d.drink_from) window.early++;
      else if (d.year > d.drink_to) window.late++;
      else window.inside++;
    }

    res.json({
      cellar,
      months: months.map(month => ({ month, drank: byMonth.get(month) || 0, added: addedByMonth.get(month) || 0 })),
      drank: drank.length,
      added: added.reduce((a, x) => a + x.n, 0),
      byType: count(drank, d => d.type),
      byCountry: count(drank, d => d.country || "Okänt land").slice(0, 8),
      byUser: count(drank, d => d.user || "Okänd"),
      window,
    });
  });

  return r;
}
