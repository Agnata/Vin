// Rough defaults for new wines that lack a drinking window or taste dials.
// Values are on the same 1–12 scale as the seed data.
const BY_TYPE = {
  rott:   { from: 2, to: 8,  kind: "r", taste: [8, 7, 7] },
  vitt:   { from: 1, to: 5,  kind: "w", taste: [7, 2, 8] },
  rose:   { from: 0, to: 2,  kind: "w", taste: [6, 2, 8] },
  bubbel: { from: 3, to: 12, kind: "w", taste: [6, 2, 10] },
  orange: { from: 1, to: 6,  kind: "r", taste: [8, 6, 8] },
};

export function estimate(wine) {
  const d = BY_TYPE[wine.type] || BY_TYPE.rott;
  const year = /^\d{4}$/.test(wine.vintage || "") ? Number(wine.vintage) : null;
  return {
    drink_from: wine.drink_from ?? (year ? year + d.from : null),
    drink_to: wine.drink_to ?? (year ? year + d.to : null),
    taste_kind: wine.taste_kind ?? d.kind,
    taste1: wine.taste1 ?? d.taste[0],
    taste2: wine.taste2 ?? d.taste[1],
    taste3: wine.taste3 ?? d.taste[2],
  };
}
