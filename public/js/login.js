import { api } from "./common.js";

const $ = id => document.getElementById(id);
$("email").focus();

$("form").addEventListener("submit", async e => {
  e.preventDefault();
  $("err").textContent = "";
  $("submit").disabled = true;
  try {
    await api("/api/login", { method: "POST", body: { email: $("email").value, password: $("password").value } });
    const next = new URLSearchParams(location.search).get("next");
    location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/kallaren";
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
