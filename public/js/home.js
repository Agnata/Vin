import { TYPES, ORDER, dial } from "./common.js";

const $ = id => document.getElementById(id);
$("dialIll").innerHTML = dial(9, "Fyllighet") + dial(7, "Strävhet") + dial(6, "Fruktsyra");
$("dialIll").querySelectorAll(".dial").forEach(d => d.style.setProperty("--c", "var(--rott)"));

const [stats, me] = await Promise.all([
  fetch("/api/public").then(r => r.json()).catch(() => ({})),
  fetch("/api/me").then(r => r.json()).catch(() => ({})),
]);

if (me.user) {
  for (const id of ["navBtn", "ctaBtn", "footLink"]) {
    $(id).href = "/kallaren";
    $(id).textContent = "Till källaren";
  }
}
if (!me.claude) $("claudeTag").remove();

if (stats.bottles) {
  const rack = $("rack");
  for (const t of ORDER) {
    for (let i = 0; i < (stats.types?.[t] || 0); i++) {
      const c = document.createElement("span");
      c.className = "cap static";
      c.style.setProperty("--c", `var(--${t})`);
      rack.appendChild(c);
    }
  }
  const typeCount = ORDER.filter(t => stats.types?.[t]).length;
  $("stats").innerHTML = [
    [stats.bottles, "flaskor"],
    [stats.countries, "länder"],
    [stats.producers, "producenter"],
    [typeCount, typeCount === 1 ? "vintyp" : "vintyper"],
  ].map(([n, l]) => `<div><b>${n}</b><span>${l}</span></div>`).join("");
  $("stats").classList.remove("hidden");
  $("stats").title = ORDER.filter(t => stats.types?.[t]).map(t => `${TYPES[t]} ${stats.types[t]}`).join(", ");
}
