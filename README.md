# Vinkällaren

Vår gemensamma vinkällare på **https://vin.parnes.com**: en publik framsida som beskriver källaren och en inloggad del med hela listan, drickfönster, smakklockor och förslag på vin till maten.

- **Node 22+ / Express** bakom **Apache 2** som reverse proxy
- **SQLite** (`better-sqlite3`), en fil, backup varje natt
- **Inloggning** med e-post och lösenord (scrypt-hash, sessionscookie), "Glömt lösenord" via e-post
- **Admin:** bjud in, redigera och ta bort användare, ge administratörsroll, skicka länkar för nytt lösenord
- **Prenumeration:** varje användare väljer under Konto om de vill ha mejl dagligen, varje vecka eller inte alls
- **Claude** för vinförslag finns inbyggt men är avstängt (`CLAUDE_ENABLED=false`).

## Kör lokalt

```bash
npm install
npm run seed                                   # läser in data/wines-seed.json
npm run add-user -- du@exempel.se "Ditt namn" --admin   # frågar efter lösenord
npm run dev                                    # http://127.0.0.1:3000
npm test
```

## Struktur

```
server/    app.js (routes), auth.js, db.js (schema + migreringar), mailer.js, mail-templates.js, digest.js,
           estimate.js, routes/ (wines, account, admin, claude)
public/    index.html (framsida), login.html, losenord.html, kallaren.html, konto.html, admin.html, css/, js/
scripts/   seed.js, add-user.js, backup.js, send-digests.js
deploy/    Apache-vhost, systemd-tjänst, timers för backup och utskick, env-exempel
data/      wines-seed.json (källaren som den såg ut vid flytten från artefakten)
docs/      plan.md
```

## Installation på Ubuntu-servern

Kör som en användare med sudo. Node 22 eller senare behövs, till exempel från NodeSource.

```bash
# 1. Paket och Node
sudo apt update && sudo apt install -y apache2 git build-essential certbot python3-certbot-apache
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs

# 2. Systemanvändare, kataloger och kod
sudo useradd --system --home /opt/vinkallaren --shell /usr/sbin/nologin vinkallaren
sudo mkdir -p /var/lib/vinkallaren /var/backups/vinkallaren
sudo git clone https://github.com/Agnata/Vin.git /opt/vinkallaren
sudo chown -R vinkallaren:vinkallaren /opt/vinkallaren /var/lib/vinkallaren /var/backups/vinkallaren
cd /opt/vinkallaren && sudo -u vinkallaren npm ci --omit=dev

# 3. Inställningar
sudo cp deploy/vinkallaren.env.example /etc/vinkallaren.env
sudo chown root:vinkallaren /etc/vinkallaren.env && sudo chmod 640 /etc/vinkallaren.env

#    Fyll i e-postinställningarna i /etc/vinkallaren.env (se "E-post" nedan).

# 4. Data och första administratören. Övriga bjuds in från sidan Admin.
sudo -u vinkallaren env DB_PATH=/var/lib/vinkallaren/vin.db npm run seed
sudo -u vinkallaren env DB_PATH=/var/lib/vinkallaren/vin.db npm run add-user -- du@parnes.com "Ditt namn" --admin

# 5. Tjänst, nattlig backup och morgonutskick
sudo cp deploy/vinkallaren.service deploy/vinkallaren-*.service deploy/vinkallaren-*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now vinkallaren vinkallaren-backup.timer vinkallaren-digest.timer

# 6. Apache och certifikat (DNS för vin.parnes.com måste peka på servern)
sudo a2enmod proxy proxy_http headers ssl http2 rewrite
sudo cp deploy/apache-vin.parnes.com.conf /etc/apache2/sites-available/vin.parnes.com.conf
sudo certbot certonly --apache -d vin.parnes.com
sudo a2ensite vin.parnes.com && sudo apachectl configtest && sudo systemctl reload apache2

# 7. Brandvägg
sudo ufw allow OpenSSH && sudo ufw allow 'Apache Full' && sudo ufw enable
```

### Uppdatera

```bash
cd /opt/vinkallaren && sudo -u vinkallaren git pull && sudo -u vinkallaren npm ci --omit=dev && sudo systemctl restart vinkallaren
```

Databasen uppdateras automatiskt vid start (migreringar i `server/db.js`). Har du lagt till nya filer i `deploy/`, kopiera dem till `/etc/systemd/system/` och kör `sudo systemctl daemon-reload`.

```bash
```

### E-post

E-post används till inbjudningar, "Glömt lösenord" och prenumerationerna. Välj ett av alternativen i `/etc/vinkallaren.env`:

- **SMTP** (enklast att få levererat): fyll i `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER` och `SMTP_PASS`, till exempel från ert e-postkonto eller en tjänst som Postmark, Mailgun eller Amazon SES. Lägg till SPF- och DKIM-poster för `parnes.com` enligt tjänstens instruktioner, annars hamnar mejlen lätt i skräpposten.
- **Lokal postfix:** `sudo apt install postfix` och sätt `SMTP_HOST=localhost` och `SMTP_PORT=25`.

Utan e-post fungerar allt ändå. Adminsidan visar då inbjudnings- och återställningslänkarna så att du kan skicka dem själv, och prenumerationerna väntar tills e-posten är på plats.

Utskicken körs varje morgon kl. 07:43 av `vinkallaren-digest.timer`. Dagliga prenumeranter får ett mejl när något har hänt sedan förra utskicket, och veckoprenumeranter får ett på måndagar med veckans händelser och viner som bör drickas snart. Varje mejl har en länk för att avsluta direkt. Testa manuellt med `sudo systemctl start vinkallaren-digest` och `journalctl -u vinkallaren-digest`.

### Backup

`vinkallaren-backup.timer` sparar en kopia varje natt kl. 03:17 i `/var/backups/vinkallaren` och behåller de 30 senaste. Kopiera katalogen till en annan maskin eller molnlagring också, till exempel med `rclone` eller `rsync`. Återställ genom att stoppa tjänsten och kopiera en backupfil till `/var/lib/vinkallaren/vin.db`.

### Slå på Claude

Lägg en API-nyckel från console.anthropic.com i `/etc/vinkallaren.env`, sätt `CLAUDE_ENABLED=true` och kör `sudo systemctl restart vinkallaren`. Då visas "Fråga Claude i stället" i källaren. Varje fråga kostar några ören.
