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
