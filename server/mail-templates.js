// Plain-text and HTML versions of every e-mail the app sends.
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const TYPE_COLOR = { rott: "#6B1A2A", vitt: "#CDB24E", rose: "#DC928E", bubbel: "#E3D69A", orange: "#C46E27" };

function layout(title, body, footer = "") {
  return `<!doctype html><html lang="sv"><body style="margin:0;background:#DEDDD5;padding:24px 12px;font-family:Georgia,'Times New Roman',serif;color:#1E211F">
<div style="max-width:560px;margin:0 auto;background:#E9E8E1;border-radius:12px;padding:28px 24px">
<p style="margin:0 0 4px;font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#5C605A">Vinkällaren</p>
<h1 style="margin:0 0 18px;font-weight:400;font-size:30px;line-height:1.15">${esc(title)}</h1>
${body}
</div>
${footer ? `<p style="max-width:560px;margin:14px auto 0;font-size:13px;color:#5C605A;text-align:center">${footer}</p>` : ""}
</body></html>`;
}
const button = (href, label) =>
  `<p style="margin:22px 0"><a href="${esc(href)}" style="background:#6B1A2A;color:#fff;text-decoration:none;padding:10px 20px;border-radius:999px;display:inline-block">${esc(label)}</a></p>`;
const p = s => `<p style="margin:0 0 12px;font-size:17px;line-height:1.5">${s}</p>`;

export function inviteMail({ name, link, invitedBy }) {
  return {
    subject: "Välkommen till Vinkällaren",
    text: `Hej ${name}!\n\n${invitedBy} har bjudit in dig till Vinkällaren, vår gemensamma vinkällare.\n\nVälj ditt lösenord här (länken gäller i 7 dagar):\n${link}\n`,
    html: layout(`Välkommen, ${name}`,
      p(`${esc(invitedBy)} har bjudit in dig till Vinkällaren, vår gemensamma vinkällare.`) +
      p("Välj ett lösenord för att komma igång. Länken gäller i 7 dagar.") + button(link, "Välj lösenord")),
  };
}

export function resetMail({ name, link }) {
  return {
    subject: "Nytt lösenord till Vinkällaren",
    text: `Hej ${name}!\n\nNågon bad om ett nytt lösenord för ditt konto. Välj ett nytt här (länken gäller i 2 timmar):\n${link}\n\nOm det inte var du kan du strunta i det här mejlet.\n`,
    html: layout("Nytt lösenord",
      p(`Hej ${esc(name)}! Någon bad om ett nytt lösenord för ditt konto. Länken gäller i 2 timmar.`) +
      button(link, "Välj nytt lösenord") + p("Om det inte var du kan du strunta i det här mejlet.")),
  };
}

const EVENT_TEXT = {
  added: "lades in", drank: "dracks", opened: "öppnades", deleted: "togs bort",
};

// events: [{kind, detail, user, name, type, vintage, created_at}], soon: wines to drink soon
export function digestMail({ name, period, events, soon, baseUrl, unsubscribeUrl, settingsUrl }) {
  const heading = period === "weekly" ? "Veckan i källaren" : "Senaste nytt i källaren";
  const line = e => `${e.name}${e.vintage ? " " + e.vintage : ""} ${EVENT_TEXT[e.kind]}${e.user ? ` av ${e.user}` : ""}` +
    (e.kind === "drank" && e.detail ? ` – ”${e.detail}”` : "");
  const soonLine = w => `${w.name}${w.vintage ? " " + w.vintage : ""} (bäst till ${w.drink_to})`;
  const dot = t => `<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${TYPE_COLOR[t] || "#5C605A"};margin-right:8px"></span>`;
  const list = items => `<ul style="list-style:none;margin:0 0 18px;padding:0">${items}</ul>`;
  const li = (t, s) => `<li style="padding:7px 0;border-top:1px solid #BEBEB4;font-size:16px">${dot(t)}${esc(s)}</li>`;

  let text = `Hej ${name}!\n\n`;
  let html = "";
  if (events.length) {
    text += "Det här har hänt:\n" + events.map(e => "  • " + line(e)).join("\n") + "\n\n";
    html += `<h2 style="font-weight:400;font-size:21px;margin:0 0 6px">Det här har hänt</h2>` + list(events.map(e => li(e.type, line(e))).join(""));
  }
  if (soon.length) {
    text += "Bör drickas snart:\n" + soon.map(w => "  • " + soonLine(w)).join("\n") + "\n\n";
    html += `<h2 style="font-weight:400;font-size:21px;margin:0 0 6px">Bör drickas snart</h2>` + list(soon.map(w => li(w.type, soonLine(w))).join(""));
  }
  text += `Öppna källaren: ${baseUrl}/kallaren\n\nÄndra eller avsluta prenumerationen: ${settingsUrl}\nAvsluta direkt: ${unsubscribeUrl}\n`;
  return {
    subject: period === "weekly" ? "Veckan i Vinkällaren" : "Nytt i Vinkällaren",
    text,
    html: layout(heading, p(`Hej ${esc(name)}!`) + html + button(`${baseUrl}/kallaren`, "Öppna källaren"),
      `Du får det här mejlet eftersom du prenumererar på uppdateringar. <a href="${esc(settingsUrl)}" style="color:#6B1A2A">Ändra</a> · <a href="${esc(unsubscribeUrl)}" style="color:#6B1A2A">Avsluta prenumerationen</a>`),
    headers: { "List-Unsubscribe": `<${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  };
}
