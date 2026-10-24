import { api, esc, renderNav, toast } from "./common.js";

const $ = id => document.getElementById(id);
const DIGEST = { off: "", daily: "Mejl dagligen", weekly: "Mejl varje vecka" };
const me = (await api("/api/me")).user;
renderNav(me, "/admin");

let users = [];
const date = s => s ? new Date(s.replace(" ", "T") + "Z").toLocaleDateString("sv-SE", { year: "numeric", month: "short", day: "numeric" }) : "";

function linkBox(link) {
  return `<div class="linkbox"><input readonly value="${esc(link)}" aria-label="Länk att skicka"><button type="button" class="btn small ghost" data-copy>Kopiera</button></div>`;
}

function render(links = {}) {
  $("users").innerHTML = users.map(u => `<li class="user" data-id="${u.id}">
    <div>
      <div class="nm">${esc(u.name)}${u.id === me.id ? ' <span class="badge">du</span>' : ""}</div>
      <div class="meta">${esc(u.email)}</div>
      <div class="badges">
        ${u.is_admin ? '<span class="badge admin">Administratör</span>' : ""}
        ${u.last_login_at ? `<span class="badge">Senast inloggad ${date(u.last_login_at)}</span>` : `<span class="badge">${u.invited ? "Inbjuden, har inte loggat in" : "Har inte loggat in"}</span>`}
        ${DIGEST[u.digest] ? `<span class="badge">${DIGEST[u.digest]}</span>` : ""}
      </div>
      ${links[u.id] ? linkBox(links[u.id]) : ""}
    </div>
    <div class="acts">
      <button type="button" class="btn small ghost" data-act="edit">Redigera</button>
      <button type="button" class="btn small ghost" data-act="link">${u.last_login_at ? "Återställ lösenord" : "Skicka inbjudan igen"}</button>
    </div>
  </li>`).join("");
}

async function load(links) {
  const data = await api("/api/admin/users");
  users = data.users;
  $("noMail").classList.toggle("hidden", data.mail);
  render(links);
}

$("users").onclick = async e => {
  const copy = e.target.closest("[data-copy]");
  if (copy) {
    const input = copy.previousElementSibling;
    input.select();
    try { await navigator.clipboard.writeText(input.value); toast("Länken är kopierad."); } catch { document.execCommand("copy"); }
    return;
  }
  const b = e.target.closest("[data-act]"); if (!b) return;
  const u = users.find(x => x.id === Number(b.closest(".user").dataset.id));
  if (b.dataset.act === "edit") return openDialog(u);
  b.disabled = true;
  try {
    const r = await api(`/api/admin/users/${u.id}/link`, { method: "POST", body: {} });
    const what = r.purpose === "invite" ? "En ny inbjudan" : "En länk för nytt lösenord";
    if (r.mailed) { toast(`${what} är skickad till ${u.email}.`); await load(); }
    else { toast(`${what} är skapad. Kopiera och skicka den själv.`); await load({ [u.id]: r.link }); }
  } catch (err) { toast(err.message); b.disabled = false; }
};

// ---------- invite / edit dialog ----------
const dlg = $("dlg"), form = $("userForm");
let editing = null;

function openDialog(u) {
  editing = u || null;
  form.reset();
  $("formErr").textContent = "";
  $("dlgH").textContent = u ? `Redigera ${u.name}` : "Bjud in";
  $("saveBtn").textContent = u ? "Spara" : "Skicka inbjudan";
  $("dlgNote").classList.toggle("hidden", !!u);
  $("delBtn").classList.toggle("hidden", !u || u.id === me.id);
  if (u) {
    form.elements.name.value = u.name;
    form.elements.email.value = u.email;
    form.elements.is_admin.checked = !!u.is_admin;
    form.elements.is_admin.disabled = u.id === me.id;
  } else form.elements.is_admin.disabled = false;
  dlg.showModal();
  form.elements.name.focus();
}
$("inviteBtn").onclick = () => openDialog(null);
$("cancelBtn").onclick = () => dlg.close();

form.onsubmit = async e => {
  e.preventDefault();
  $("formErr").textContent = "";
  const body = { name: form.elements.name.value.trim(), email: form.elements.email.value.trim() };
  if (!form.elements.is_admin.disabled) body.is_admin = form.elements.is_admin.checked;
  $("saveBtn").disabled = true;
  try {
    if (editing) {
      await api(`/api/admin/users/${editing.id}`, { method: "PATCH", body });
      dlg.close(); toast("Sparat."); await load();
    } else {
      const r = await api("/api/admin/users", { method: "POST", body });
      dlg.close();
      if (r.mailed) { toast(`Inbjudan är skickad till ${r.user.email}.`); await load(); }
      else { toast("Användaren är skapad. Kopiera länken och skicka den själv."); await load({ [r.user.id]: r.link }); }
    }
  } catch (err) { $("formErr").textContent = err.message; }
  finally { $("saveBtn").disabled = false; }
};

$("delBtn").onclick = async () => {
  if (!editing || !confirm(`Ta bort ${editing.name}? Personen kan inte längre logga in. Historiken i källaren finns kvar.`)) return;
  try {
    await api(`/api/admin/users/${editing.id}`, { method: "DELETE" });
    dlg.close(); toast(`${editing.name} är borttagen.`); await load();
  } catch (err) { $("formErr").textContent = err.message; }
};

await load();
