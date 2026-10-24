# Vinkällaren

Vår gemensamma vinkällare på **https://vin.parnes.com**: en publik framsida som beskriver källaren och en inloggad del med hela listan, drickfönster, smakklockor och förslag på vin till maten.

- **Node 22+ / Express** bakom **Apache 2** som reverse proxy
- **SQLite** (`better-sqlite3`), en fil, backup varje natt
- **Inloggning** med e-post och lösenord (scrypt-hash, sessionscookie). Användare skapas från kommandoraden.
- **Claude** för vinförslag finns inbyggt men är avstängt (`CLAUDE_ENABLED=false`).

## Kör lokalt

```bash
npm install
npm run seed                                   # läser in data/wines-seed.json
npm run add-user -- du@exempel.se "Ditt namn"  # frågar efter lösenord
npm run dev                                    # http://127.0.0.1:3000
npm test
```

## Struktur

```
server/    app.js (routes), auth.js, db.js (schema), estimate.js, routes/wines.js, routes/claude.js
public/    index.html (framsida), login.html, kallaren.html, css/, js/
scripts/   seed.js, add-user.js, backup.js
deploy/    Apache-vhost, systemd-tjänst, backup-timer, env-exempel
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

# 4. Data och användare (minst två)
sudo -u vinkallaren env DB_PATH=/var/lib/vinkallaren/vin.db npm run seed
sudo -u vinkallaren env DB_PATH=/var/lib/vinkallaren/vin.db npm run add-user -- anna@parnes.com "Anna"
sudo -u vinkallaren env DB_PATH=/var/lib/vinkallaren/vin.db npm run add-user -- bertil@parnes.com "Bertil"

# 5. Tjänst och nattlig backup
sudo cp deploy/vinkallaren.service deploy/vinkallaren-backup.service deploy/vinkallaren-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now vinkallaren vinkallaren-backup.timer

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

### Backup

`vinkallaren-backup.timer` sparar en kopia varje natt kl. 03:17 i `/var/backups/vinkallaren` och behåller de 30 senaste. Kopiera katalogen till en annan maskin eller molnlagring också, till exempel med `rclone` eller `rsync`. Återställ genom att stoppa tjänsten och kopiera en backupfil till `/var/lib/vinkallaren/vin.db`.

### Slå på Claude

Lägg en API-nyckel från console.anthropic.com i `/etc/vinkallaren.env`, sätt `CLAUDE_ENABLED=true` och kör `sudo systemctl restart vinkallaren`. Då visas "Fråga Claude i stället" i källaren. Varje fråga kostar några ören.
