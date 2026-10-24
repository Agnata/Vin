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
