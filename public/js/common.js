export const TYPES = { rott: "Rött", vitt: "Vitt", rose: "Rosé", bubbel: "Mousserande", orange: "Orange" };
export const ORDER = ["rott", "vitt", "rose", "bubbel", "orange"];
export const col = t => `var(--${t})`;
export const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function dial(v, label) {
  let ticks = "";
  for (let i = 0; i < 12; i++) {
    const a = (i + 0.5) / 12 * 2 * Math.PI - Math.PI / 2, c = Math.cos(a), s = Math.sin(a);
    ticks += `<line class="tk${i < v ? " on" : ""}" x1="${(15 + 9 * c).toFixed(2)}" y1="${(15 + 9 * s).toFixed(2)}" x2="${(15 + 13 * c).toFixed(2)}" y2="${(15 + 13 * s).toFixed(2)}"/>`;
  }
  return `<span class="dial"><svg viewBox="0 0 30 30" aria-hidden="true">${ticks}<text x="15" y="18.5" text-anchor="middle">${v}</text></svg><span>${label}</span></span>`;
}

// fetch wrapper for the JSON API; throws Error with the server's message.
export async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 && !path.startsWith("/api/login")) {
    location.href = `/login?next=${encodeURIComponent(location.pathname)}`;
    throw new Error("Du behöver logga in.");
  }
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Fel ${res.status}`);
  return data;
}

// Top bar for signed-in pages: brand, page links (Admin only for admins) and log out.
export function renderNav(user, active) {
  const nav = document.getElementById("nav");
  const links = [["/kallaren", "Källaren"], ["/statistik", "Statistik"], ["/konto", "Konto"], ...(user?.is_admin ? [["/admin", "Admin"]] : [])];
  nav.innerHTML = `<a class="brand" href="/">vin.parnes.com</a>
    <span class="who">${links.map(([href, label]) =>
      `<a href="${href}"${href === active ? ' aria-current="page"' : ""}>${label}</a>`).join("")}
      <button type="button" class="linkbtn" id="logout">Logga ut</button></span>`;
  document.getElementById("logout").onclick = async () => {
    await api("/api/logout", { method: "POST", body: {} }).catch(() => {});
    location.href = "/";
  };
}

let toastTimer;
export function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("on"), 2800);
}
