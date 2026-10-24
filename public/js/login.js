import { api } from "./common.js";

const $ = id => document.getElementById(id);
let ticket = null;
function goNext() {
  const next = new URLSearchParams(location.search).get("next");
  location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/kallaren";
}
$("email").focus();

$("form").addEventListener("submit", async e => {
  e.preventDefault();
  $("err").textContent = "";
  $("submit").disabled = true;
  try {
    const r = await api("/api/login", { method: "POST", body: { email: $("email").value, password: $("password").value } });
    if (r.totp_required) {
      ticket = r.ticket;
      $("form").classList.add("hidden");
      $("totp").classList.remove("hidden");
      $("code").focus();
      return;
    }
    goNext();
  } catch (err) {
    $("err").textContent = err.message;
    $("password").select();
  } finally {
    $("submit").disabled = false;
  }
});

// ---------- forgot password ----------
function showForgot(on) {
  $("form").classList.toggle("hidden", on);
  $("forgot").classList.toggle("hidden", !on);
  if (on) { $("fEmail").value = $("email").value; $("fEmail").focus(); } else $("email").focus();
}
$("forgotLink").onclick = () => showForgot(true);
$("backLink").onclick = () => showForgot(false);
if (location.hash === "#glomt") showForgot(true);

$("forgot").addEventListener("submit", async e => {
  e.preventDefault();
  $("fSubmit").disabled = true;
  try {
    const r = await api("/api/password/forgot", { method: "POST", body: { email: $("fEmail").value } });
    $("fMsg").style.color = "var(--muted)";
    $("fMsg").textContent = r.mail
      ? "Om adressen finns hos oss har vi skickat en länk. Kolla din inkorg, och skräpposten."
      : "E-post är inte inställd på servern än. Be en administratör om en länk för nytt lösenord.";
  } catch (err) {
    $("fMsg").textContent = err.message;
  } finally { $("fSubmit").disabled = false; }
});

// ---------- second step ----------
$("totp").addEventListener("submit", async e => {
  e.preventDefault();
  $("totpErr").textContent = "";
  $("totpSubmit").disabled = true;
  try {
    const r = await api("/api/login/totp", { method: "POST", body: { ticket, code: $("code").value } });
    if (r.recoveryLeft != null) alert(`Du loggade in med en reservkod. ${r.recoveryLeft} återstår. Skapa nya under Konto om det börjar ta slut.`);
    goNext();
  } catch (err) {
    $("totpErr").textContent = err.message;
    $("code").select();
    if (/gått ut/.test(err.message)) setTimeout(() => location.reload(), 1500);
  } finally { $("totpSubmit").disabled = false; }
});
$("totpBack").onclick = () => location.reload();
