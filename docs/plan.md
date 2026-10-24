# Plan för Vinkällaren

## Beslut

| Fråga | Beslut |
|---|---|
| Användare | Minst två, en gemensam källare. Skapas med `npm run add-user`. |
| Publikt | En framsida som beskriver källaren och visar totaler (flaskor, länder, producenter). Enskilda viner kräver inloggning. Totalerna stängs av med `PUBLIC_STATS=false`. |
| Adress | https://vin.parnes.com |
| Claude | Inbyggt men avstängt (`CLAUDE_ENABLED=false`). |
| Server | Ubuntu, Apache 2 som reverse proxy med Let's Encrypt, Node under systemd. |
| Lagring | SQLite-fil i `/var/lib/vinkallaren`, nattlig backup med systemd-timer. |

## Klart

1. **Grund:** Express, SQLite-schema (`users`, `sessions`, `wines`, `events`), seed med de 185 vinerna (191 flaskor) från artefakten.
2. **Inloggning:** scrypt-hashade lösenord, sessionscookie (`HttpOnly`, `SameSite=Lax`, `Secure` i produktion), rate limit på inloggningen, skydd mot CSRF genom att skrivningar kräver JSON från samma ursprung, `helmet` med CSP.
3. **Redigering:** lägga till, ändra och ta bort viner, "Drack en", "Öppnad", historik per vin. Drickfönster och smakklockor uppskattas när de lämnas tomma.
4. **Framsida:** publik beskrivning med hyllan av flaskor och totaler.
5. **Drift:** Apache-vhost, systemd-tjänst, backup-timer, env-exempel, installationssteg i README.
6. **Claude:** `/api/claude/pair` med strukturerat JSON-svar, bara aktivt när det är påslaget.

## Att göra

- **Rätta data** i källaren (går nu via "Redigera"):
  - *Le Volte dell'Ornellaia, 2022* och *Catena Paraje Altamira Malbec 2022*: årgången i namnet skiljer sig från fältet (2021).
  - *Fundamentalista Manchuela*: regionen står som Rioja.
  - *Crane Lake Merlot*: druvorna anges som malbec och cabernet sauvignon eller zinfandel.
  - *Brancaria Tre*: troligen Brancaia, som den andra posten.
  - *Principium*: saknar druva.
- **Backup utanför servern** (rclone/rsync till annan maskin).
- **Automatisk driftsättning** via GitHub Actions och SSH, om manuell `git pull` blir jobbigt.
- **Senare:** statistik över vad som druckits, export till CSV, byta lösenord i gränssnittet, Claude-förslag på drickfönster för nya viner.
