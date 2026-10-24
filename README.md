# Vinkällaren

Vår gemensamma vinkällare på **https://vin.parnes.com**: en publik framsida som beskriver källaren och en inloggad del med hela listan, drickfönster, smakklockor och förslag på vin till maten.

- **Node 24 / Express** bakom **Apache**, på samma server och med samma upplägg som LB3
- **SQLite** via `node:sqlite` (WAL), inga native-beroenden
- **Inloggning** med e-post och lösenord (scrypt-hash, sessionscookie), "Glömt lösenord" via e-post
- **Admin:** bjud in, redigera och ta bort användare, administratörsroll, länkar för nytt lösenord, driftstatus och backuper
- **Prenumeration:** varje användare väljer under Konto om de vill ha mejl dagligen, varje vecka eller inte alls
- **Backup** varje natt inuti tjänsten, extern kopia med rsync, `/api/health`
- **Claude** för vinförslag finns inbyggt men är avstängt (`CLAUDE_ENABLED=false`)

## Kör lokalt

```bash
npm install
npm run seed                                            # läser in data/wines-seed.json
npm run add-user -- du@exempel.se "Ditt namn" --admin   # frågar efter lösenord
npm run dev                                             # http://127.0.0.1:3000
npm test
```

## Installera och uppgradera på servern

```bash
cd /home/parnes/work/vin
git pull
./deploy/install.sh --check
sudo ./deploy/install.sh
```

Allt om drift finns i **[docs/drift.md](docs/drift.md)**: sökvägar, miljöfil, systemd, Apache, backup, extern kopia, health, rollback och vad som ska verifieras på servern.

## Struktur

```
server/    app.js (routes), auth.js, db.js (schema + migreringar), backups.js, health.js, scheduler.js,
           mailer.js, mail-templates.js, digest.js, clock.js, estimate.js, routes/ (wines, account, admin, claude)
public/    index.html (framsida), login.html, losenord.html, kallaren.html, konto.html, admin.html, css/, js/
scripts/   seed.js, add-user.js, backup.js, send-digests.js
deploy/    install.sh, systemd- och Apache-mallar, offsite-skript, env-mall
data/      wines-seed.json (källaren som den såg ut vid flytten från artefakten)
docs/      drift.md, plan.md
```
