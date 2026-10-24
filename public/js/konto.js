import { api, renderNav, toast } from "./common.js";

const $ = id => document.getElementById(id);
const DIGEST_TEXT = { off: "Du får inga mejl.", daily: "Du får ett mejl på morgonen när något har hänt.", weekly: "Du får ett mejl varje måndag." };

const account = await api("/api/account");
renderNav(account, "/konto");
const showLede = a => $("lede").textContent = `Inloggad som ${a.name} (${a.email})${a.is_admin ? ", administratör" : ""}.`;
showLede(account);
$("noMail").classList.toggle("hidden", account.mail);

const digestForm = $("digestForm");
digestForm.elements.digest.value = account.digest;
digestForm.onchange = async () => {
  try {
    const a = await api("/api/account", { method: "PATCH", body: { digest: digestForm.elements.digest.value } });
    toast(DIGEST_TEXT[a.digest]);
  } catch (err) { toast(err.message); }
};

const nameForm = $("nameForm");
nameForm.elements.name.value = account.name;
nameForm.onsubmit = async e => {
  e.preventDefault();
  try {
    const a = await api("/api/account", { method: "PATCH", body: { name: nameForm.elements.name.value } });
    showLede(a);
    toast("Namnet är sparat.");
  } catch (err) { toast(err.message); }
};

const pwForm = $("pwForm");
pwForm.elements.username.value = account.email;
pwForm.onsubmit = async e => {
  e.preventDefault();
  $("pwErr").textContent = "";
  try {
    await api("/api/account/password", { method: "POST", body: { current: pwForm.elements.current.value, password: pwForm.elements.password.value } });
    pwForm.reset();
    pwForm.elements.username.value = account.email;
    toast("Lösenordet är bytt.");
  } catch (err) { $("pwErr").textContent = err.message; }
};

// ---------- two-step verification ----------
const tfa = { start: $("tfaStart"), confirm: $("tfaConfirm"), codes: $("tfaCodes"), manage: $("tfaManage") };
if (new URLSearchParams(location.search).get("krav") === "tvasteg") $("krav").classList.remove("hidden");

function showTfa(a, view) {
  for (const el of Object.values(tfa)) el.classList.add("hidden");
  const t = a.totp;
  $("tfaStatus").innerHTML = t.enabled
    ? `<strong style="font-weight:600">Påslagen.</strong> ${t.recoveryLeft} oanvända reservkoder kvar.`
    : `<strong style="font-weight:600">Avstängd.</strong>${a.is_admin ? " Du behöver slå på den för att använda Admin." : ""}`;
  (view ? tfa[view] : t.enabled ? tfa.manage : tfa.start).classList.remove("hidden");
}
showTfa(account);

function showCodes(a, codes) {
  $("tfaCodeList").textContent = codes.join("\n");
  showTfa(a, "codes");
  $("tfaDone").onclick = () => { showTfa(a); if (a.is_admin) $("krav").classList.add("hidden"); };
}
$("tfaCopy").onclick = async () => { try { await navigator.clipboard.writeText($("tfaCodeList").textContent); toast("Koderna är kopierade."); } catch { toast("Markera och kopiera koderna själv."); } };
$("tfaDownload").onclick = () => {
  const blob = new Blob([`Reservkoder för Vinkällaren (${account.email})\n\n${$("tfaCodeList").textContent}\n`], { type: "text/plain" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: "vinkallaren-reservkoder.txt" });
  a.click(); URL.revokeObjectURL(a.href);
};

tfa.start.onsubmit = async e => {
  e.preventDefault(); $("tfaStartErr").textContent = "";
  try {
    const r = await api("/api/account/totp/setup", { method: "POST", body: { password: tfa.start.elements.password.value } });
    tfa.start.reset();
    $("tfaQr").innerHTML = r.qr;
    $("tfaQr").querySelector("svg")?.setAttribute("aria-label", "QR-kod för appen");
    $("tfaSecret").textContent = r.secret.match(/.{1,4}/g).join(" ");
    showTfa(account, "confirm");
    tfa.confirm.elements.code.focus();
  } catch (err) { $("tfaStartErr").textContent = err.message; }
};
tfa.confirm.onsubmit = async e => {
  e.preventDefault(); $("tfaConfirmErr").textContent = "";
  try {
    const r = await api("/api/account/totp/confirm", { method: "POST", body: { code: tfa.confirm.elements.code.value } });
    tfa.confirm.reset();
    Object.assign(account, r);
    toast("Tvåstegsverifiering är påslagen.");
    showCodes(account, r.recoveryCodes);
  } catch (err) { $("tfaConfirmErr").textContent = err.message; }
};
$("tfaNewCodes").onclick = async () => {
  $("tfaManageErr").textContent = "";
  try {
    const r = await api("/api/account/totp/recovery", { method: "POST", body: { password: tfa.manage.elements.password.value } });
    tfa.manage.reset(); Object.assign(account, r);
    showCodes(account, r.recoveryCodes);
  } catch (err) { $("tfaManageErr").textContent = err.message; }
};
$("tfaOff").onclick = async () => {
  $("tfaManageErr").textContent = "";
  if (account.is_admin && !confirm("Utan tvåstegsverifiering kommer du inte åt Admin. Stänga av ändå?")) return;
  try {
    const r = await api("/api/account/totp/disable", { method: "POST", body: { password: tfa.manage.elements.password.value, code: tfa.manage.elements.code.value } });
    tfa.manage.reset(); Object.assign(account, r);
    toast("Tvåstegsverifiering är avstängd."); showTfa(account);
  } catch (err) { $("tfaManageErr").textContent = err.message; }
};
