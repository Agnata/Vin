# Plan för Vinkällaren

## Beslut

| Fråga | Beslut |
|---|---|
| Användare | Minst två, en gemensam källare. Första administratören skapas med `npm run add-user -- … --admin`, övriga bjuds in från Admin. |
| Admin | Administratörer kan bjuda in, redigera, ta bort och befordra användare och skicka länkar för nytt lösenord. Det finns alltid minst en administratör. |
| E-post | Prenumeration per användare: av, dagligen eller varje vecka. SMTP (extern tjänst eller lokal postfix). Utan e-post visas länkarna för administratören i stället. |
| Publikt | En framsida som beskriver källaren och visar totaler (flaskor, länder, producenter). Enskilda viner kräver inloggning. Totalerna stängs av med `PUBLIC_STATS=false`. |
| Adress | https://vin.parnes.com |
| Claude | Inbyggt men avstängt (`CLAUDE_ENABLED=false`). |
| Server | Samma server och upplägg som LB3: Apache med Let's Encrypt framför Node 24 under systemd, rootägd kod i `/opt/vinkallaren/app`, `install.sh` med `--check`. Se `docs/drift.md`. |
| Lagring | SQLite (`node:sqlite`) i `/var/lib/vinkallaren`, backup inuti tjänsten varje natt, extern kopia med rsync. |

## Klart

1. **Grund:** Express, SQLite-schema (`users`, `sessions`, `wines`, `events`), seed med de 185 vinerna (191 flaskor) från artefakten.
2. **Inloggning:** scrypt-hashade lösenord, sessionscookie (`HttpOnly`, `SameSite=Lax`, `Secure` i produktion), rate limit på inloggningen, skydd mot CSRF genom att skrivningar kräver JSON från samma ursprung, `helmet` med CSP.
3. **Redigering:** lägga till, ändra och ta bort viner, "Drack en", "Öppnad", historik per vin. Drickfönster och smakklockor uppskattas när de lämnas tomma.
4. **Framsida:** publik beskrivning med hyllan av flaskor och totaler.
5. **Drift:** `deploy/install.sh` efter LB3:s modell, systemd-tjänst med sandbox, Apache-include, `/api/health`, backup i tjänsten, offsite-timer. Dokumenterat i `docs/drift.md`.
6. **Claude:** `/api/claude/pair` med strukturerat JSON-svar, bara aktivt när det är påslaget.
7. **Admin:** sidan `/admin` med inbjudningar via engångslänk (7 dagar), redigering, administratörsroll, borttagning och återställningslänkar (2 timmar).
8. **Konto:** sidan `/konto` för namn, lösenord och prenumeration. "Glömt lösenord?" på inloggningen.
9. **Prenumeration:** dagliga och veckovisa sammanfattningar via `vinkallaren-digest.timer`, avregistrering med ett klick (även `List-Unsubscribe`).
10. **Export:** hela källaren som CSV som öppnas direkt i Excel.

## Att göra

- **Rätta data** i källaren (går nu via "Redigera"):
  - *Le Volte dell'Ornellaia, 2022* och *Catena Paraje Altamira Malbec 2022*: årgången i namnet skiljer sig från fältet (2021).
  - *Fundamentalista Manchuela*: regionen står som Rioja.
  - *Crane Lake Merlot*: druvorna anges som malbec och cabernet sauvignon eller zinfandel.
  - *Brancaria Tre*: troligen Brancaia, som den andra posten.
  - *Principium*: saknar druva.
- **Verifiera på servern** enligt avsnitt 15 i `docs/drift.md`, och välj mål för extern backup.
- **Återställning av backup från Admin** (finns i LB3; här görs den manuellt än så länge).
- **E-post på servern:** välj SMTP-tjänst och lägg in SPF/DKIM för `parnes.com`.
- **Senare:** statistik över vad som druckits, Claude-förslag på drickfönster för nya viner.
