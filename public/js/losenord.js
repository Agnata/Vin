import { api } from "./common.js";

const $ = id => document.getElementById(id);
const token = new URLSearchParams(location.search).get("t");

try {
  const info = await api(`/api/password/token?t=${encodeURIComponent(token || "")}`);
  $("h").textContent = info.purpose === "invite" ? `Välkommen, ${info.name}` : "Nytt lösenord";
  $("lede").textContent = info.purpose === "invite"
    ? "Välj ett lösenord så kommer du in i källaren."
    : `Välj ett nytt lösenord för ${info.email}.`;
  $("email").value = info.email;
  $("form").classList.remove("hidden");
  $("password").focus();
} catch (err) {
  $("h").textContent = "Länken fungerar inte";
  $("lede").innerHTML = `${err.message} Be en administratör om en ny länk, eller använd <a href="/login#glomt">Glömt lösenord</a>.`;
}

$("form").onsubmit = async e => {
  e.preventDefault();
  $("err").textContent = "";
  if ($("password").value !== $("password2").value) { $("err").textContent = "Lösenorden är inte likadana."; return; }
  $("submit").disabled = true;
  try {
    const r = await api("/api/password/set", { method: "POST", body: { token, password: $("password").value } });
    // Accounts with two-step verification sign in again with password + code.
    location.href = r.login ? "/login?next=%2Fkallaren" : "/kallaren";
  } catch (err) {
    $("err").textContent = err.message;
    $("submit").disabled = false;
  }
};
