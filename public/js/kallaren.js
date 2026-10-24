import { TYPES, ORDER, col, esc, dial, api, renderNav, toast } from "./common.js";

const $ = id => document.getElementById(id);
const YEAR = new Date().getFullYear();
let WINES = [];
let lands = [];
const state = { type: "alla", land: "", q: "", fon: "" };

function status(w) {
  if (!w.f) return { k: "nu", l: "Drick nu", d: "ingen årgång" };
  if (YEAR < w.f) return { k: "vanta", l: "Kan vänta", d: `bäst från ${w.f}` };
  if (YEAR > w.u) return { k: "passerat", l: "Drick snarast", d: `bäst till ${w.u}` };
  if (w.u - YEAR <= 1) return { k: "snart", l: "Drick snart", d: `bäst till ${w.u}` };
  return { k: "nu", l: "Drick nu", d: `bäst till ${w.u}` };
}

// API row -> the compact shape the rest of this file uses.
function fromApi(r) {
  const w = {
    id: "w" + r.id, dbId: r.id, raw: r, t: r.type, n: r.name, p: r.producer, g: r.grapes, v: r.vintage,
    c: r.country || "Okänt land", r: r.region, q: r.quantity, o: !!r.opened, s: r.style,
    f: r.drink_from, u: r.drink_to,
    tk: r.taste_kind ? { k: r.taste_kind, v: [r.taste1, r.taste2, r.taste3] } : null,
  };
  w.st = status(w);
  tagWine(w);
  return w;
}

// ---------- header, rack and filters ----------
const rack = $("rack");
function rebuild() {
  const bottles = WINES.reduce((a, w) => a + w.q, 0);
  const byLand = {};
  WINES.forEach(w => byLand[w.c] = (byLand[w.c] || 0) + w.q);
  lands = Object.keys(byLand).sort((a, b) => byLand[b] - byLand[a] || a.localeCompare(b, "sv"));
  const nb = k => WINES.filter(w => k.includes(w.st.k)).reduce((a, w) => a + w.q, 0);
  $("lede").textContent = !bottles ? "Källaren är tom. Lägg till det första vinet."
    : `${bottles} ${bottles === 1 ? "flaska" : "flaskor"} från ${lands.length} ${lands.length === 1 ? "land" : "länder"}` +
      (lands.length > 1 ? `, mest från ${lands[0]} och ${lands[1]}` : "") +
      `. ${nb(["nu", "snart", "passerat"])} är redo att drickas och ${nb(["vanta"])} behöver vila ett tag till.`;

  rack.innerHTML = "";
  ORDER.forEach(t => {
    WINES.filter(w => w.t === t).sort((a, b) => lands.indexOf(a.c) - lands.indexOf(b.c)).forEach(w => {
      for (let k = 0; k < w.q; k++) {
        const b = document.createElement("button");
        b.className = "cap"; b.style.setProperty("--c", col(t));
        b.dataset.id = w.id; b.title = w.n;
        b.setAttribute("aria-label", `${w.n}${w.v ? ", " + w.v : ""}`);
        b.onclick = () => go(w);
        rack.appendChild(b);
      }
    });
  });
  $("legend").innerHTML = ORDER.map(t => {
    const n = WINES.filter(w => w.t === t).reduce((a, w) => a + w.q, 0);
    return n ? `<li><i style="--c:${col(t)}"></i>${TYPES[t]} ${n}</li>` : "";
  }).join("");

  const sel = $("land"), keep = state.land;
  sel.innerHTML = `<option value="">Alla länder</option>` + lands.map(l => `<option>${esc(l)}</option>`).join("");
  sel.value = lands.includes(keep) ? keep : "";
  state.land = sel.value;
  $("countries").innerHTML = lands.map(l => `<option value="${esc(l)}">`).join("");
  render();
}

$("types").innerHTML = [["alla", "Alla"], ...ORDER.map(t => [t, TYPES[t]])]
  .map(([k, l]) => `<button type="button" data-t="${k}" aria-pressed="${k === "alla"}">${l}</button>`).join("");
$("types").onclick = e => {
  const b = e.target.closest("button"); if (!b) return;
  state.type = b.dataset.t;
  [...$("types").children].forEach(x => x.setAttribute("aria-pressed", x === b));
  render();
};
$("land").onchange = e => { state.land = e.target.value; render(); };
$("fonster").onchange = e => { state.fon = e.target.value; render(); };
$("q").oninput = e => { state.q = e.target.value.trim().toLowerCase(); render(); };

const DIAL_L = { r: ["Fyllighet", "Strävhet", "Fruktsyra"], w: ["Fyllighet", "Sötma", "Fruktsyra"] };
function dials(w) {
  if (!w.tk || w.tk.v.some(v => v == null)) return "";
  const L = DIAL_L[w.tk.k];
  return `<div class="dials" role="img" aria-label="${L.map((l, i) => l + " " + w.tk.v[i] + " av 12").join(", ")}">${w.tk.v.map((v, i) => dial(v, L[i])).join("")}</div>`;
}
function match(w) {
  if (state.type !== "alla" && w.t !== state.type) return false;
  if (state.land && w.c !== state.land) return false;
  if (state.fon === "nu" && w.st.k === "vanta") return false;
  if (state.fon === "snart" && !["snart", "passerat"].includes(w.st.k)) return false;
  if (state.fon === "vanta" && w.st.k !== "vanta") return false;
  if (state.q) {
    const h = [w.n, w.p, w.g, w.r, w.c, w.s, w.v].join(" ").toLowerCase();
    if (!state.q.split(/\s+/).every(x => h.includes(x))) return false;
  }
  return true;
}
function render() {
  const hits = WINES.filter(match); const ids = new Set(hits.map(w => w.id));
  rack.querySelectorAll(".cap").forEach(c => c.classList.toggle("dim", !ids.has(c.dataset.id)));
  if (!hits.length) {
    $("list").innerHTML = WINES.length ? `<p class="empty">Inget vin matchar. Prova ett annat sökord eller välj Alla.</p>` : "";
    return;
  }
  $("list").innerHTML = lands.filter(l => hits.some(w => w.c === l)).map(l => {
    const ws = hits.filter(w => w.c === l).sort((a, b) => ORDER.indexOf(a.t) - ORDER.indexOf(b.t) || (a.r || "").localeCompare(b.r || "", "sv") || a.n.localeCompare(b.n, "sv"));
    const n = ws.reduce((a, w) => a + w.q, 0);
    return `<section class="country"><h2>${esc(l)}<small>${n} ${n === 1 ? "flaska" : "flaskor"}</small></h2><ol class="wines">` +
      ws.map(w => `<li class="wine" id="${w.id}" style="--c:${col(w.t)}"><span class="dot" aria-hidden="true"></span>
        <div><div class="name">${esc(w.n)}</div>
        <div class="meta">${esc(w.p)}${w.r ? ", " + esc(w.r) : ""}${w.s ? ", " + esc(w.s) : ""}</div>
        ${w.g ? `<div class="meta grape">${esc(w.g)}</div>` : ""}
        ${w.o ? `<div class="open">Öppnad</div>` : ""}${dials(w)}
        <div class="acts" data-id="${w.dbId}">
          <button type="button" data-act="drink">Drack en</button>
          <button type="button" data-act="open">${w.o ? "Inte öppnad" : "Öppnad"}</button>
          <button type="button" data-act="edit">Redigera</button>
        </div></div>
        <div class="yr">${w.v ? esc(w.v) : "<span class='qty'>utan årgång</span>"}${w.q > 1 ? `<span class="qty">${w.q} flaskor</span>` : ""}<span class="st ${w.st.k}"><b>${w.st.l}</b><br>${w.st.d}</span></div></li>`).join("") +
      `</ol></section>`;
  }).join("");
}
function go(w) {
  if (!match(w)) {
    state.type = "alla"; state.land = ""; state.q = ""; state.fon = "";
    $("q").value = ""; $("land").value = ""; $("fonster").value = "";
    [...$("types").children].forEach(x => x.setAttribute("aria-pressed", x.dataset.t === "alla"));
    render();
  }
  const el = $(w.id); if (!el) return;
  el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion:reduce)").matches ? "auto" : "smooth", block: "center" });
  el.classList.remove("flash"); void el.offsetWidth; el.classList.add("flash");
}

// Replace one wine after a change; drops it when no bottles remain.
function replaceWine(row) {
  const i = WINES.findIndex(w => w.dbId === row.id);
  if (row.quantity > 0) { if (i >= 0) WINES[i] = fromApi(row); else WINES.push(fromApi(row)); }
  else if (i >= 0) WINES.splice(i, 1);
  rebuild();
}

$("list").onclick = async e => {
  const b = e.target.closest(".acts button"); if (!b) return;
  const id = Number(b.parentElement.dataset.id);
  const w = WINES.find(x => x.dbId === id); if (!w) return;
  if (b.dataset.act === "edit") return openDialog(w);
  b.disabled = true;
  try {
    if (b.dataset.act === "drink") {
      const row = await api(`/api/wines/${id}/drink`, { method: "POST", body: {} });
      replaceWine(row);
      toast(row.quantity ? `Skål! ${row.quantity} kvar av ${w.n}.` : `Skål! Det var sista flaskan ${w.n}.`);
      if (row.quantity) $(w.id)?.querySelector('[data-act="drink"]')?.focus();
    } else {
      const row = await api(`/api/wines/${id}/open`, { method: "POST", body: { opened: !w.o } });
      replaceWine(row);
      $(w.id)?.querySelector('[data-act="open"]')?.focus();
    }
  } catch (err) { toast(err.message); b.disabled = false; }
};

// ---------- add / edit dialog ----------
const dlg = $("dlg"), form = $("wineForm");
let editing = null;
const FIELDS = ["name", "type", "vintage", "producer", "grapes", "country", "region", "style", "quantity", "drink_from", "drink_to", "taste1", "taste2", "taste3", "note"];
const NUMS = new Set(["quantity", "drink_from", "drink_to", "taste1", "taste2", "taste3"]);

function syncTasteLabel() {
  const red = ["rott", "orange"].includes(form.elements.type.value);
  $("t2label").firstChild.textContent = red ? "Strävhet" : "Sötma";
}
form.elements.type.onchange = syncTasteLabel;

let claudeOn = false;
async function openDialog(w) {
  $("scan").classList.toggle("hidden", !claudeOn || !!w);
  $("scanMsg").textContent = "Claude fyller i uppgifterna. Kontrollera dem innan du sparar.";
  editing = w || null;
  form.reset();
  $("formErr").textContent = "";
  $("dlgH").textContent = w ? "Redigera vin" : "Lägg till vin";
  $("delBtn").classList.toggle("hidden", !w);
  $("histWrap").classList.add("hidden");
  if (w) {
    for (const f of FIELDS) form.elements[f].value = w.raw[f] ?? "";
    form.elements.opened.checked = !!w.raw.opened;
  }
  syncTasteLabel();
  dlg.showModal();
  form.elements.name.focus();
  if (w) {
    try {
      const h = await api(`/api/wines/${w.dbId}/history`);
      const L = { added: "Lades in", drank: "Drack en flaska", opened: "Öppnades", closed: "Markerades som inte öppnad", edited: "Ändrades" };
      $("hist").innerHTML = h.map(e => `<li>${esc(e.created_at.slice(0, 10))} · ${esc(L[e.kind] || e.kind)}${e.user ? ` av ${esc(e.user)}` : ""}${e.kind === "drank" && e.detail ? `: ${esc(e.detail)}` : ""}</li>`).join("");
      $("histWrap").classList.toggle("hidden", !h.length);
    } catch { /* history is optional */ }
  }
}
$("addBtn").onclick = () => openDialog(null);
$("cancelBtn").onclick = () => dlg.close();

form.onsubmit = async e => {
  e.preventDefault();
  const body = {};
  for (const f of FIELDS) {
    const v = form.elements[f].value.trim();
    body[f] = NUMS.has(f) ? (v === "" ? null : Number(v)) : v;
  }
  if (body.quantity === null) body.quantity = 1;
  body.opened = form.elements.opened.checked;
  const red = ["rott", "orange"].includes(body.type);
  body.taste_kind = red ? "r" : "w";
  if (!body.name) { $("formErr").textContent = "Vinet behöver ett namn."; form.elements.name.focus(); return; }
  $("saveBtn").disabled = true;
  try {
    const row = editing
      ? await api(`/api/wines/${editing.dbId}`, { method: "PATCH", body })
      : await api("/api/wines", { method: "POST", body });
    dlg.close();
    replaceWine(row);
    toast(editing ? "Sparat." : `${row.name} ligger nu i källaren.`);
    if (row.quantity > 0) go(WINES.find(w => w.dbId === row.id));
  } catch (err) {
    $("formErr").textContent = err.message;
  } finally { $("saveBtn").disabled = false; }
};

$("delBtn").onclick = async () => {
  if (!editing || !confirm(`Ta bort ${editing.n} helt ur källaren? Använd hellre ”Drack en” om flaskan har druckits.`)) return;
  try {
    await api(`/api/wines/${editing.dbId}`, { method: "DELETE" });
    WINES = WINES.filter(w => w.dbId !== editing.dbId);
    dlg.close(); rebuild(); toast("Vinet är borttaget.");
  } catch (err) { $("formErr").textContent = err.message; }
};

// ---------- pairing ----------
const TAGRULES = [
  [/pinot noir|pinot nero|gamay|trousseau|poulsard|beaujolais|mavro|lefkada/i, "lattrod"],
  [/sangiovese|chianti|tempranillo|merlot|montepulciano|corvina|barbera|dolcetto|cabernet franc|grenache|garnacha|carignan|nero d'avola|nerello|abouriou|negroamaro|canaiolo|colorino|rondinella/i, "mellanrod"],
  [/nebbiolo|barolo|barbaresco|cabernet sauvignon|syrah|shiraz|malbec|aglianico|monastrell|maratheftiko|tintorera|primitivo|amarone|marselan|mourvèdre|zinfandel|petit verdot/i, "fylligrod"],
];
const WHITE_FRESH = /sauvignon blanc|riesling|alvarinho|loureiro|grüner|melon|aligoté|verdicchio|vermentino|carricante|grillo|xyn|furmint|macabeo|pinot grigio|arinto|fernão|grechetto|turbiana|cortese|prié|procanico|sauvignon gris/i;
const WHITE_RICH = /chardonnay|marsanne|viognier|semillon|sémillon|pinot gris(?!io)|moscaminer/i;
const AROMATIC = /gewürz|muscat|moscato|riesling|pinot gris(?!io)|moscaminer/i;
function tagWine(w) {
  const h = (w.g + " " + w.n).toLowerCase(); const T = new Set();
  if (w.t === "rott") { let lvl = -1; TAGRULES.forEach(([re], i) => { if (re.test(h)) lvl = Math.max(lvl, i); }); T.add(lvl < 0 ? "mellanrod" : TAGRULES[lvl][1]); }
  if (w.t === "vitt") {
    if (WHITE_FRESH.test(h) || /chablis|mâcon|viré|jura|muscadet|véran/i.test(h)) T.add("friskvitt");
    if (WHITE_RICH.test(h) && !/chablis|muscadet/i.test(h)) T.add("fylligtvitt");
    if (AROMATIC.test(h)) T.add("aromatiskt");
    if (!T.size) T.add("friskvitt");
  }
  if (w.t === "rose") T.add("rose");
  if (w.t === "orange") T.add("orange");
  if (w.t === "bubbel") { T.add("bubbel"); if (/moscato|muscat/i.test(h)) T.add("sott"); }
  if (w.t === "sott") T.add("sott");
  w.tags = T; w.h = [w.n, w.p, w.g, w.r, w.c, w.s].join(" ").toLowerCase();
}
const has = (w, re) => re.test(w.h);
const DISHES = [
  { id: "skaldjur", l: "Skaldjur och ostron", w: { friskvitt: 3, bubbel: 3, rose: 1 }, b: w => has(w, /muscadet|chablis|alvarinho|blanc de blancs|champagne|albariño/) ? 2 : 0,
    y: { friskvitt: "Frisk syra och mineralitet som lyfter skaldjurens sötma.", bubbel: "Bubblor och syra är en klassiker till ostron och räkor.", rose: "Torr rosé fungerar fint till en skaldjursbuffé." } },
  { id: "fisk", l: "Vit fisk", w: { friskvitt: 3, fylligtvitt: 2, bubbel: 2 }, b: w => has(w, /bourgogne|chablis|loire|riesling/) ? 1 : 0,
    y: { friskvitt: "Ett friskt vitt som inte tar över den milda fisken.", fylligtvitt: "Rundare vitt för fisk med smör- eller gräddsås.", bubbel: "Mousserande passar bra till lättare fiskrätter." } },
  { id: "lax", l: "Lax", w: { fylligtvitt: 3, friskvitt: 2, rose: 2, lattrod: 2, bubbel: 1 }, b: w => has(w, /pinot noir|chardonnay/) ? 1 : 0,
    y: { fylligtvitt: "Fylligt vitt matchar laxens fetma.", friskvitt: "Syran skär igenom laxens fett.", rose: "Rosé är ett säkert kort till lax.", lattrod: "Lätt rött med låga tanniner går fint till lax.", bubbel: "Bubblor rensar gommen mellan tuggorna." } },
  { id: "kyckling", l: "Kyckling", w: { fylligtvitt: 3, lattrod: 2, friskvitt: 1, rose: 1, orange: 1 }, b: () => 0,
    y: { fylligtvitt: "Rundare vitt som gifter sig med ljust kött.", lattrod: "Lätt, bärigt rött som inte tar över.", friskvitt: "Friskt vitt för kyckling med citrus eller örter.", rose: "En allround-rosé till grillad kyckling.", orange: "Orangevinets struktur klarar kryddig kyckling." } },
  { id: "flask", l: "Fläsk", w: { mellanrod: 2, lattrod: 2, fylligtvitt: 2, aromatiskt: 1, rose: 1 }, b: () => 0,
    y: { mellanrod: "Saftigt rött med lagom tanniner till fläskkött.", lattrod: "Lätt rött med frisk frukt som balanserar fettet.", fylligtvitt: "Fylligt vitt till fläskfilé med gräddsås.", aromatiskt: "Aromatiskt vitt till fläsk med sötma, till exempel äpple.", rose: "Rosé fungerar till sidfläsk och grillat." } },
  { id: "not", l: "Grillat nötkött", w: { fylligrod: 3, mellanrod: 2 }, b: w => has(w, /malbec|cabernet sauvignon|syrah|shiraz/) ? 1 : 0,
    y: { fylligrod: "Kraftigt rött vars tanniner möter köttets proteiner.", mellanrod: "Medelfylligt rött till en mindre tung köttbit." } },
  { id: "lamm", l: "Lamm", w: { fylligrod: 3, mellanrod: 2 }, b: w => has(w, /rioja|tempranillo|bordeaux|rhône|syrah/) ? 1 : 0,
    y: { fylligrod: "Kraftigt rött som klarar lammets smak.", mellanrod: "Kryddigt medelfylligt rött, klassiskt till lamm." } },
  { id: "vilt", l: "Vilt: älg, ren, hjort", w: { fylligrod: 3, mellanrod: 2, lattrod: 1 }, b: w => has(w, /nebbiolo|syrah|shiraz|amarone|pinot noir/) ? 1 : 0,
    y: { fylligrod: "Mörk frukt och struktur till viltets djupa smak.", mellanrod: "Medelfylligt rött med jordiga toner till vilt.", lattrod: "Elegant pinot noir till renfilé eller renskav." } },
  { id: "pasta", l: "Pasta och pizza med tomat", w: { mellanrod: 3, lattrod: 1, fylligrod: 1 }, b: w => w.c === "Italien" && w.t === "rott" ? 2 : 0,
    y: { mellanrod: "Syrlig röd frukt som matchar tomatens syra.", lattrod: "Lätt och syrligt rött till enklare tomaträtter.", fylligrod: "Kraftigare rött till köttfärssås och lasagne." } },
  { id: "svamp", l: "Svamp och risotto", w: { lattrod: 3, fylligtvitt: 2, orange: 1, mellanrod: 1 }, b: w => has(w, /nebbiolo|pinot noir|bourgogne/) ? 2 : 0,
    y: { lattrod: "Pinot noir och svamp delar jordiga toner.", fylligtvitt: "Krämigt vitt till risotto.", orange: "Orangevin har umami som passar svamp.", mellanrod: "Jordigt rött till mustiga svamprätter." } },
  { id: "asiatiskt", l: "Kryddig asiatisk mat", w: { aromatiskt: 3, friskvitt: 2, rose: 2, bubbel: 1 }, b: w => has(w, /riesling|gewürz|pinot gris/) ? 1 : 0,
    y: { aromatiskt: "Aromatiskt vitt med fruktighet som dämpar hettan.", friskvitt: "Friskt och fruktigt vitt som svalkar.", rose: "Fruktig rosé klarar kryddor bra.", bubbel: "Bubblor svalkar efter stark mat." } },
  { id: "ost", l: "Ostbricka", w: { mellanrod: 2, bubbel: 2, orange: 2, sott: 2, aromatiskt: 1, fylligtvitt: 1, fylligrod: 1 }, b: w => has(w, /barbera|amarone|ripasso|portvin|\bport\b|sauternes|tokaj/) ? 1 : 0,
    y: { mellanrod: "Fruktigt rött till lagrade hårdostar.", bubbel: "Bubblor passar till krämiga och vitmögelostar.", orange: "Orangevin klarar en blandad ostbricka.", aromatiskt: "Aromatiskt vitt till blåmögel och kryddiga ostar.", fylligtvitt: "Fylligt vitt till mjuka ostar.", fylligrod: "Kraftigt rött till riktigt lagrad ost.", sott: "Sött vin till blåmögel och lagrad ost, som Sauternes till Roquefort." } },
  { id: "tapas", l: "Tapas och chark", w: { rose: 3, mellanrod: 2, bubbel: 2 }, b: w => w.c === "Spanien" ? 2 : w.c === "Italien" ? 1 : 0,
    y: { rose: "Torr rosé är lätt att para med många små rätter.", mellanrod: "Saftigt rött till chark och lufttorkad skinka.", bubbel: "Cava och andra bubblor till salta tilltugg." } },
  { id: "aperitif", l: "Aperitif", w: { bubbel: 3, friskvitt: 2, rose: 2 }, b: w => has(w, /champagne|crémant|cava/) ? 1 : 0,
    y: { bubbel: "Ett glas bubbel väcker aptiten.", friskvitt: "Ett lätt och friskt vitt att börja kvällen med.", rose: "En lätt rosé att mingla med." } },
  { id: "dessert", l: "Dessert och choklad", w: { sott: 4 }, b: w => w.t === "sott" ? 1 : 0,
    y: { sott: "Vinet bör vara sötare än desserten. Sauternes och Tokaji till frukt och crème brûlée, portvin till choklad." } },
];
const hash = s => { let x = 0; for (const ch of s) x = (x * 31 + ch.charCodeAt(0)) | 0; return x; };
function suggest(d) {
  const scored = WINES.map(w => {
    let best = 0, tag = null;
    for (const t of w.tags) { const v = d.w[t] || 0; if (v > best) { best = v; tag = t; } }
    if (!best) return null;
    return { w, tag, s: best + d.b(w) + (w.st.k === "vanta" ? -2 : w.st.k === "snart" ? .4 : 0) };
  }).filter(Boolean);
  scored.sort((a, b) => b.s - a.s || hash(a.w.n + d.id) - hash(b.w.n + d.id));
  const out = [], prod = {}, tagN = {};
  for (const x of scored) {
    if (out.length >= 6) break;
    if ((prod[x.w.p] || 0) >= 1) continue; if ((tagN[x.tag] || 0) >= 3) continue;
    prod[x.w.p] = (prod[x.w.p] || 0) + 1; tagN[x.tag] = (tagN[x.tag] || 0) + 1; out.push({ w: x.w, why: d.y[x.tag] });
  }
  return out;
}
function showPicks(list, intro) {
  const out = $("pairOut");
  if (!list.length) { out.innerHTML = `<p class="intro">Inget i källaren passar riktigt till det här. Prova en annan rätt.</p>`; return; }
  out.innerHTML = (intro ? `<p class="intro">${esc(intro)}</p>` : "") + list.map((x, i) =>
    `<button type="button" class="pick" data-i="${i}" style="--c:${col(x.w.t)}"><span class="dot" aria-hidden="true"></span>
     <span><span class="name">${esc(x.w.n)}</span><span class="why" style="display:block">${esc(x.why || "")}</span>
     <span class="st ${x.w.st.k}" style="text-align:left"><b>${x.w.st.l}</b>, ${x.w.st.d}${x.w.o ? ", redan öppnad" : ""}</span></span>
     <span class="yr">${esc(x.w.v || "")}</span></button>`).join("");
  out.querySelectorAll(".pick").forEach(b => b.onclick = () => go(list[+b.dataset.i].w));
}
$("dishes").innerHTML = DISHES.map(d => `<button type="button" data-d="${d.id}" aria-pressed="false">${esc(d.l)}</button>`).join("");
$("dishes").onclick = e => {
  const b = e.target.closest("button"); if (!b) return;
  const on = b.getAttribute("aria-pressed") !== "true";
  [...$("dishes").children].forEach(x => x.setAttribute("aria-pressed", on && x === b));
  if (!on) { $("pairOut").innerHTML = ""; return; }
  const d = DISHES.find(x => x.id === b.dataset.d); const p = suggest(d);
  showPicks(p, d.id === "dessert" && p.length < 3 ? "Källaren har få söta viner, så här är det som finns." : "");
};

// ---------- free text ----------
const WORDS = [
  ["skaldjur", /räk|hummer|krabb|ostron|mussl|kräft|havskräft|pilgrims|skaldjur|bläckfisk|calamar|scampi/],
  ["lax", /lax|röding|öring|gravad|rökt fisk/],
  ["fisk", /torsk|sej|gös|abborre|sik|kolja|hälleflund|rödspätt|piggvar|fisk|sill|strömming|tonfisk|kummel/],
  ["kyckling", /kyckling|kalkon|höns|coq au vin/],
  ["flask", /fläsk|skinka|karré|kotlett|korv|bacon|revben|pulled pork|kassler|julbord|prinskorv|köttbullar|pytt/],
  ["not", /biff|entrecôte|entrecote|oxfilé|ryggbiff|nötkött|hamburgare|burgare|högrev|grytstek|oxkind|picanha|flankstek|steak|t-bone|kalv|stroganoff|bourguignon|gulasch|chili con carne/],
  ["lamm", /lamm|fårstek|fårkött|moussaka|kebab/],
  ["vilt", /ren|renskav|älg|hjort|rådjur|vilt|vildsvin|anka|fasan|ripa|and(bröst)?\b|viltgryta|kalops/],
  ["pasta", /pasta|pizza|lasagn|bolognese|spaghetti|tomatsås|tomat|carbonara|penne|ravioli|gnocchi|marinara/],
  ["svamp", /svamp|kantarell|karljohan|trattkantarell|champinjon|tryffel|risotto|portabello|murkla/],
  ["asiatiskt", /thai|curry|chili|stark|sushi|kinesisk|indisk|asiatisk|wok|pad thai|ramen|tacos|mexikansk|koreansk|vietnamesisk|dumplings|teriyaki/],
  ["ost", /\bost|ostbricka|brie|chèvre|getost|parmesan|västerbotten|gruyère|blåmögel|gorgonzola|roquefort|cheddar|fondue|raclette/],
  ["tapas", /tapas|chark|salami|prosciutto|serrano|oliver|plockmat|antipasti|mezze|paella/],
  ["aperitif", /aperitif|fördrink|mingel|snittar|kanapé|chips/],
  ["dessert", /choklad|dessert|tårta|glass|kaka|paj|pannacotta|tiramisu|crème brûlée|bär|frukt|praliner|pannkak|våffl|sylt|smulpaj|kladdkaka|mousse|sött/],
];
const MODS = [
  [/grädd|smör|ost(sås)?|krämig|beurre blanc|hollandaise|bearnaise|béarnaise/, { fylligtvitt: 1.5 }],
  [/citron|lime|örter|dill|sallad|ceviche|rå\b|tartar/, { friskvitt: 1.5, bubbel: .5 }],
  [/grill|rökt|bbq|stekt/, { fylligrod: .5, rose: .5 }],
  [/lingon|rödvinssås|rödvin/, { mellanrod: 1, fylligrod: .5 }],
  [/kokos|ingefära|sötsur|honung/, { aromatiskt: 1.5 }],
];
function parseDish(txt) {
  const s = " " + txt.toLowerCase() + " ";
  let hits = WORDS.filter(([, re]) => re.test(s)).map(([id]) => DISHES.find(d => d.id === id));
  if (hits.some(d => d.id === "dessert") && /tryffel/.test(s) && !/choklad/.test(s)) hits = hits.filter(d => d.id !== "dessert");
  if (hits.some(d => d.id === "vilt") && /renskav|ren\b|renfilé/.test(s) === false && /\bren\b/.test(s) === false && !/älg|hjort|rådjur|vilt|vildsvin|anka|fasan|ripa|kalops/.test(s)) hits = hits.filter(d => d.id !== "vilt");
  if (!hits.length) return null;
  const w = {}, y = {}; const bs = hits.map(d => d.b);
  hits.forEach(d => { for (const k in d.w) { w[k] = (w[k] || 0) + d.w[k]; if (!y[k] || d.w[k] > (hits.find(x => x.y[k] === y[k])?.w[k] || 0)) y[k] = d.y[k]; } });
  MODS.forEach(([re, add]) => { if (re.test(s)) for (const k in add) if (w[k] !== undefined || add[k] > 1) w[k] = (w[k] || 0) + add[k]; });
  for (const k in w) if (!y[k]) y[k] = ({ fylligtvitt: "Fylligt vitt passar till krämiga och smöriga inslag.", friskvitt: "Friskt vitt lyfter syrliga och örtiga smaker.", aromatiskt: "Aromatiskt vitt möter sötma och kryddor.", mellanrod: "Medelfylligt rött till mustiga såser.", fylligrod: "Kraftigt rött till grillade smaker.", rose: "Rosé är lätt att para med grillat." })[k] || "";
  return { id: "fri", l: hits.map(d => d.l).join(", "), w, y, b: x => bs.reduce((a, f) => a + f(x), 0) };
}
const btn = $("askBtn"), inp = $("askIn");
function local() {
  const txt = inp.value.trim(); if (!txt) { inp.focus(); return; }
  [...$("dishes").children].forEach(x => x.setAttribute("aria-pressed", "false"));
  const d = parseDish(txt);
  if (!d) { $("pairOut").innerHTML = `<p class="intro">Sidan känner inte igen rätten. Prova att skriva huvudråvaran, till exempel lax, kyckling eller svamp, eller välj en rätt nedan.</p>`; return; }
  showPicks(suggest(d), `Förslag till ${d.l.toLowerCase()}:`);
}
btn.onclick = local; inp.onkeydown = e => { if (e.key === "Enter") local(); };

// ---------- Claude (only when the server has it switched on) ----------
// ---------- label photo -> form (Claude) ----------
// Shrinks the photo to at most 1568 px on the long side (what the model uses anyway) as JPEG.
function shrink(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1568 / Math.max(img.width, img.height));
      const c = Object.assign(document.createElement("canvas"), { width: Math.round(img.width * k), height: Math.round(img.height * k) });
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      resolve(c.toDataURL("image/jpeg", 0.85).split(",")[1]);
    };
    img.onerror = () => reject(new Error("Bilden gick inte att läsa."));
    img.src = URL.createObjectURL(file);
  });
}
$("scanBtn").onclick = () => $("scanFile").click();
$("scanFile").onchange = async e => {
  const file = e.target.files[0]; e.target.value = "";
  if (!file) return;
  $("scanMsg").textContent = "Claude läser etiketten…";
  try {
    const r = await api("/api/claude/label", { method: "POST", body: { image: await shrink(file), media_type: "image/jpeg" } });
    for (const f of FIELDS) if (f !== "quantity" && r[f] != null && r[f] !== "") form.elements[f].value = r[f];
    syncTasteLabel();
    $("scanMsg").textContent = "Klart. Kontrollera uppgifterna, särskilt årgång och drickfönster, innan du sparar.";
    form.elements.name.focus();
  } catch (err) { $("scanMsg").textContent = err.message; }
};

function enableClaude() {
  claudeOn = true;
  $("askNote").classList.add("on");
  const cb = $("claudeBtn");
  cb.onclick = async () => {
    const dish = inp.value.trim(); if (!dish) { inp.focus(); return; }
    [...$("dishes").children].forEach(x => x.setAttribute("aria-pressed", "false"));
    cb.disabled = true; btn.disabled = true; $("pairOut").innerHTML = `<p class="intro">Claude tänker…</p>`;
    try {
      const r = await api("/api/claude/pair", { method: "POST", body: { dish } });
      const picks = r.val.map(v => { const w = WINES.find(x => x.dbId === v.id); return w ? { w, why: v.motivering } : null; }).filter(Boolean);
      showPicks(picks, r.intro);
    } catch (err) {
      $("pairOut").innerHTML = `<p class="intro">${esc(err.message)} Tryck på Föreslå vin i stället.</p>`;
    } finally { cb.disabled = false; btn.disabled = false; }
  };
}

// ---------- start ----------
try {
  const [me, rows] = await Promise.all([api("/api/me"), api("/api/wines")]);
  renderNav(me.user, "/kallaren");
  if (me.claude) enableClaude();
  WINES = rows.map(fromApi);
  rebuild();
} catch (err) {
  $("lede").textContent = `Kunde inte hämta källaren: ${err.message}`;
}
