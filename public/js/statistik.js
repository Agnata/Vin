import { api, esc, renderNav, TYPES } from "./common.js";

const $ = id => document.getElementById(id);
const MONTHS = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const monthLabel = ym => MONTHS[Number(ym.slice(5, 7)) - 1];
const monthLong = ym => `${["januari", "februari", "mars", "april", "maj", "juni", "juli", "augusti", "september", "oktober", "november", "december"][Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const bottles = n => `${n} ${n === 1 ? "flaska" : "flaskor"}`;

const [me, s] = await Promise.all([api("/api/me"), api("/api/stats")]);
renderNav(me.user, "/statistik");

$("lede").textContent = `Källaren har ${bottles(s.cellar.bottles)} av ${s.cellar.wines} viner just nu.`;
$("heroN").textContent = s.drank;
$("tiles").innerHTML = [
  [s.added, "nya flaskor inlagda (12 mån)"],
  [s.cellar.bottles, "flaskor i källaren"],
  [s.cellar.drinkSoon, "bör drickas i år"],
].map(([n, l]) => `<div><b>${n}</b><span>${l}</span></div>`).join("");

// ---------- column chart: bottles per month ----------
function columnChart(el, rows) {
  const W = 720, H = 240, top = 22, bottom = 26, left = 28;
  const max = Math.max(1, ...rows.map(r => r.drank));
  const step = max <= 4 ? 1 : max <= 10 ? 2 : Math.ceil(max / 5);
  const yMax = Math.ceil(max / step) * step;
  const plotH = H - top - bottom, slot = (W - left) / rows.length, bw = Math.min(24, slot * 0.55);
  const y = v => top + plotH - (v / yMax) * plotH;
  let svg = "";
  for (let v = 0; v <= yMax; v += step) {
    svg += `<line class="grid" x1="${left}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text x="${left - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`;
  }
  const peak = rows.reduce((a, r, i) => (r.drank > rows[a].drank ? i : a), 0);
  rows.forEach((r, i) => {
    const cx = left + slot * i + slot / 2, h = (r.drank / yMax) * plotH, x = cx - bw / 2, yb = top + plotH;
    // 4px rounded data end, square at the baseline
    const rr = Math.min(4, h);
    if (h > 0) svg += `<path class="col" data-i="${i}" d="M${x},${yb} V${yb - h + rr} Q${x},${yb - h} ${x + rr},${yb - h} H${x + bw - rr} Q${x + bw},${yb - h} ${x + bw},${yb - h + rr} V${yb} Z"/>`;
    svg += `<text x="${cx}" y="${H - 6}" text-anchor="middle">${monthLabel(r.month)}</text>`;
    if (i === peak && r.drank > 0) svg += `<text class="val" x="${cx}" y="${yb - h - 6}" text-anchor="middle">${r.drank}</text>`;
    svg += `<rect class="hit" data-i="${i}" x="${left + slot * i}" y="${top}" width="${slot}" height="${plotH + bottom}"/>`;
  });
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Druckna flaskor per månad, högst ${rows[peak].drank} i ${monthLong(rows[peak].month)}">${svg}</svg>`;

  const tip = $("tip");
  const show = (i, ev) => {
    el.querySelectorAll(".col").forEach(c => c.classList.toggle("on", c.dataset.i == i));
    const r = rows[i];
    tip.textContent = `${monthLong(r.month)}: ${bottles(r.drank)} druckna, ${r.added} inlagda`;
    tip.classList.add("on");
    const box = ev.target.getBoundingClientRect();
    tip.style.left = `${Math.min(window.innerWidth - tip.offsetWidth - 8, Math.max(8, box.left + box.width / 2 - tip.offsetWidth / 2))}px`;
    tip.style.top = `${Math.max(8, box.top - tip.offsetHeight - 8)}px`;
  };
  const hide = () => { tip.classList.remove("on"); el.querySelectorAll(".col.on").forEach(c => c.classList.remove("on")); };
  el.querySelectorAll(".hit").forEach(h => {
    h.addEventListener("pointerenter", ev => show(h.dataset.i, ev));
    h.addEventListener("pointerdown", ev => show(h.dataset.i, ev));
    h.addEventListener("pointerleave", hide);
  });
  window.addEventListener("scroll", hide, { passive: true });
}
columnChart($("monthChart"), s.months);
$("monthTable").innerHTML = `<thead><tr><th>Månad</th><th>Druckna</th><th>Inlagda</th></tr></thead><tbody>` +
  s.months.map(r => `<tr><td>${monthLong(r.month)}</td><td>${r.drank}</td><td>${r.added}</td></tr>`).join("") + "</tbody>";

// ---------- horizontal bars ----------
function hbars(el, rows, label = r => esc(r.label)) {
  if (!rows.length) { el.innerHTML = `<li class="empty">Inget druckit än.</li>`; return; }
  const max = Math.max(...rows.map(r => r.n));
  el.innerHTML = rows.map(r => `<li><div class="lbl"><span>${label(r)}</span><span>${r.n}</span></div>
    <div class="track"><div class="bar" style="width:${(r.n / max) * 100}%"></div></div></li>`).join("");
}
hbars($("byType"), s.byType, r => `<i class="dot" style="--c:var(--${esc(r.label)})" aria-hidden="true"></i>${esc(TYPES[r.label] || r.label)}`);
hbars($("byCountry"), s.byCountry);
hbars($("byUser"), s.byUser);

// ---------- drinking window ----------
const w = s.window, known = w.early + w.inside + w.late;
const pct = n => known ? `${Math.round((n / known) * 100)} %` : "–";
$("window").innerHTML = [
  [pct(w.inside), `inom fönstret (${w.inside})`],
  [pct(w.early), `för tidigt (${w.early})`],
  [pct(w.late), `efter fönstret (${w.late})`],
].map(([n, l]) => `<div><b>${n}</b><span>${l}</span></div>`).join("") +
  (w.unknown ? `<p class="note" style="flex-basis:100%;margin:6px 0 0">${bottles(w.unknown)} utan drickfönster räknas inte.</p>` : "");
