# Drift och installation: Vinkällaren

Vinkällaren körs på samma server som LB3 och följer samma upplägg:
- rootägd kod i `/opt`, data i `/var/lib` och konfiguration i `/etc`
- en Node-tjänst under systemd bakom Apache
- backup inuti tjänsten och extern kopia med rsync
- ett installationsskript med `--check`

Sökvägarna nedan är standardvärdena i `deploy/install.sh`. De har ännu inte verifierats mot den körande servern (se avsnitt 15).

## 1. Övergripande arkitektur

| | |
|---|---|
| Publik adress | https://vin.parnes.com/ |
| Admin | https://vin.parnes.com/admin (kräver inloggning som administratör) |
| Trafikflöde | Besökare → Apache/HTTPS → proxy till Node för **alla** sökvägar |

**Apache**
- Avslutar HTTPS i en egen vhost för `vin.parnes.com`.
- Proxyar allt till Node via en genererad include. Det finns ingen DocumentRoot med appfiler och inget frontendbygge.
- Sätter HSTS.

**Backend**
- Node 24 (`/usr/local/bin/node`), minst 22.13 eftersom `node:sqlite` används.
- Express. Startpunkten är `server/app.js`.
- Lyssnar på `127.0.0.1:3104`. LB3 har 3103.
- Använder `node:sqlite` med SQLite i WAL-läge, så det finns inga native-beroenden.
- Sätter själv CSP, `Cache-Control: no-store` för API och inloggade sidor, och övriga säkerhetsheaders (helmet).

**Frontend**
- Vanlig HTML, CSS och JavaScript i `public/`, som Node serverar. Inget byggsteg.

**Schemalagt i tjänsten** (kontrolleras varje minut, ingen cron behövs):
- Backup varje natt från kl. 03 svensk tid.
- E-postutskick varje morgon från kl. 07.

## 2. Viktiga sökvägar

| Vad | Sökväg |
|---|---|
| Utvecklings-/deploycheckout | `/home/parnes/work/vin` |
| Bygganvändare | `parnes` |
| Node / npm | `/usr/local/bin/node`, `/usr/local/bin/npm` |
| Installerad applikation | `/opt/vinkallaren/app` (arbetskatalog för tjänsten) |
| Installerad commit | `/opt/vinkallaren/app/REVISION` |
| Tidigare versioner | `/opt/vinkallaren/app.previous.<UTC-tid>` (de 5 senaste sparas) |
| Miljökonfiguration | `/etc/vinkallaren.env` |
| Datakatalog | `/var/lib/vinkallaren` |
| Databas | `/var/lib/vinkallaren/vin.db` (+ `-wal`, `-shm`) |
| Applikationsbackuper | `/var/lib/vinkallaren/backups/` |
| HTTP-vhost (port 80) | `/etc/apache2/sites-available/vin.parnes.com.conf` |
| HTTPS-vhost | `/etc/apache2/sites-available/vin.parnes.com-le-ssl.conf` (skapas av certbot) |
| Genererad Apache-include | `/etc/apache2/vinkallaren-proxy.conf` |
| systemd-tjänst | `/etc/systemd/system/vinkallaren.service` |
| Extern backup | `/etc/systemd/system/vinkallaren-backup-offsite.{service,timer}` |
| Installationsbackup av konfiguration | `/var/backups/vinkallaren/install-<UTC-tid>/` |

## 3. Miljöfil och konfiguration

systemd läser produktionskonfigurationen från `/etc/vinkallaren.env`. Filen ska vara:
- ägd av `root:root` med rättigheterna `0600`
- utanför Git och utanför appkatalogen

Mallen finns i `deploy/vinkallaren.env.example`.

Grundinställningar (skrivs av installern):

```
NODE_ENV=production
HOST=127.0.0.1
PORT=3104
PUBLIC_ORIGIN=https://vin.parnes.com
DB_PATH=/var/lib/vinkallaren/vin.db
COOKIE_SECURE=true
BACKUP_OFFSITE_TARGET=
```

`PUBLIC_ORIGIN` ska vara exakt origin, alltså `https://`, ingen avslutande snedstreck och samma adress som i webbläsaren. Den används till två saker:
- Origin-kontrollen för alla skrivande API-anrop (skydd mot CSRF)
- länkarna i e-post

Ändringar kräver en omstart: `sudo systemctl restart vinkallaren`.

Övriga inställningar:

| Nyckel | Standard | |
|---|---|---|
| `MAIL_FROM` | `"Vinkällaren <vin@parnes.com>"` | Avsändare |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` | tomt, 587 | Tomt `SMTP_HOST` innebär att inga mejl skickas (de loggas). Lokal postfix: `127.0.0.1` och port `25`. |
| `SMTP_SECURE` | `false` | `true` för port 465 |
| `PUBLIC_STATS` | `true` | Totaler på den publika framsidan |
| `SESSION_DAYS` | `30` | Sessionslängd |
| `BACKUP_KEEP` | `30` | Antal lokala backuper |
| `CLAUDE_ENABLED`, `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` | `false`, tomt, `claude-opus-5-5` | Vinförslag via Claude |

Använd SMTP, som i LB3, och inte `/usr/sbin/sendmail`. Tjänstens sandbox (`NoNewPrivileges`, `ProtectSystem=strict`) hindrar skrivning till Postfix-kön.

## 4. systemd-tjänsten

Mallen finns i `deploy/vinkallaren.service`, och installern fyller i sökvägarna.

```
[Service]
Type=simple
User=vinkallaren
Group=vinkallaren
WorkingDirectory=/opt/vinkallaren/app
EnvironmentFile=/etc/vinkallaren.env
ExecStart=/usr/local/bin/node --disable-warning=ExperimentalWarning /opt/vinkallaren/app/server/app.js
Restart=on-failure
RestartSec=5
StateDirectory=vinkallaren
StateDirectoryMode=0750
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/vinkallaren
```

Tjänsteanvändaren `vinkallaren` är ett systemkonto med hemkatalogen `/var/lib/vinkallaren` och skalet `/usr/sbin/nologin`. Koden under `/opt` ägs av root.

```bash
sudo systemctl status vinkallaren --no-pager
sudo systemctl restart vinkallaren
sudo journalctl -u vinkallaren -n 100 --no-pager
sudo journalctl -u vinkallaren -f
```

## 5. Apache

Mallar:
- `deploy/apache.conf` blir `/etc/apache2/vinkallaren-proxy.conf`
- `deploy/apache-http.conf` blir port 80-vhosten, men bara om ingen HTTPS-vhost finns

Includen läggs in i HTTPS-vhosten:

```
IncludeOptional /etc/apache2/vinkallaren-proxy.conf
```

Kärnan i includen:

```
ProxyPreserveHost On
ProxyPass        / http://127.0.0.1:3104/ timeout=90
ProxyPassReverse / http://127.0.0.1:3104/
RequestHeader set X-Forwarded-Proto "https"
Header always set Strict-Transport-Security "max-age=31536000"
```

- **Moduler:** `proxy`, `proxy_http`, `headers` och `ssl`. Installern aktiverar dem vid behov.
- **Första installationen:** finns ingen HTTPS-vhost skapar installern port 80-vhosten och kör sedan:
  ```
  certbot --apache -d vin.parnes.com --redirect
  ```
  Ange gärna `CERTBOT_EMAIL=…`. Med `--no-certbot` avbryter installern i stället och visar vad som behöver göras.
- **Andra värdnamn:** vhosten har bara `ServerName vin.parnes.com` och inga alias, så andra namn hamnar aldrig här.

```bash
sudo apache2ctl configtest
sudo apache2ctl -S
sudo apache2ctl -M
sudo systemctl reload apache2
```

## 6. Installation och uppgradering

Huvudskriptet är `deploy/install.sh`.

```bash
cd /home/parnes/work/vin
git pull
./deploy/install.sh --check
sudo ./deploy/install.sh
```

| Flagga | |
|---|---|
| `--check` | Kontrollerar förutsättningarna och avslutar. Kräver inte sudo. |
| `--create-admin` | Skapar en administratör även om det redan finns en. Kräver en interaktiv terminal. |
| `--skip-tests` | Hoppar över testerna. |
| `--no-certbot` | Kör aldrig certbot. |

Installern gör följande, i ordning:

1. **Kontroller:**
   - `PUBLIC_ORIGIN`, port och sökvägar
   - repot och Node-versionen (minst 22.13)
   - bygganvändaren och systemkommandona
   - att porten är ledig, eftersom LB3 använder 3103
   - HTTPS-vhosten eller certbot
   - rsync, om extern backup är på
2. **Beroenden och tester:**
   - `npm ci --omit=dev --ignore-scripts` som `parnes`
   - `npm test`
3. **Backup av konfiguration:** miljöfil, units, proxyfil och vhostar kopieras till `/var/backups/vinkallaren/install-<tid>/`.
4. **Tjänsteanvändare och datakatalog:** användare och grupp skapas vid behov, och `/var/lib/vinkallaren` (`0750`) och `backups/` (`0700`) skapas.
5. **Applikationen:**
   - Koden kopieras till `/opt/vinkallaren/app.staging-<tid>`: `server`, `public`, `scripts`, `data`, `deploy`, `node_modules` och `package*.json`.
   - Den görs rootägd, och installern kontrollerar att den kan laddas och att `node:sqlite` fungerar.
   - Befintlig `app` flyttas till `app.previous.<tid>` och stagingkatalogen blir `app`.
6. **Miljöfilen:** hanterade nycklar skrivs om och övriga `KEY=value` bevaras (se avsnitt 7). Filen blir `root:root 0600`.
7. **Databasen:**
   - Finns ingen databas skapas den från `data/wines-seed.json`.
   - Finns ingen administratör frågar installern efter e-post, namn och lösenord. Lösenordet anges två gånger, minst 12 tecken, och lagras som en scrypt-hash.
8. **systemd:**
   - Units skrivs och `daemon-reload` körs.
   - Tjänsten aktiveras.
   - Offsite-timern slås på eller av beroende på `BACKUP_OFFSITE_TARGET`.
9. **Apache:**
   - Moduler och proxy-include skrivs.
   - Vid första installationen skapas en port 80-vhost och certbot körs.
   - `IncludeOptional` läggs in i HTTPS-vhosten och `apache2ctl configtest` körs.
   - Om configtest misslyckas återställs vhost och proxyfil, och installationen avbryts.
10. **Start:** tjänsten startas om och installern väntar på `http://127.0.0.1:3104/api/public`. Svarar den inte visas status och journal, och Apache laddas **inte** om.
11. **Apache:** laddas om.
12. **Publik kontroll:** installern kontrollerar `https://vin.parnes.com/api/health`.

Det finns sparade versioner och konfigurationsbackuper, men ingen automatisk rollback för fel efter steg 10.

## 7. Vad installern bevarar och skriver om

**Skrivs alltid om:** `NODE_ENV`, `HOST`, `PORT`, `PUBLIC_ORIGIN`, `DB_PATH` och `COOKIE_SECURE`.

**`BACKUP_OFFSITE_TARGET`:**
- Värdet i filen behålls om variabeln inte anges vid installationen.
- `BACKUP_OFFSITE_TARGET=` (uttryckligen tomt) stänger av extern kopiering.

**Bevaras:** alla andra `KEY=value`-rader, till exempel SMTP och `ANTHROPIC_API_KEY`. Saknade standardnycklar läggs till med standardvärden.

**Tas bort:** kommentarsrader, precis som i LB3.

Kontrollera parametrarna innan du upprepar en anpassad installation, annars återinförs standardvärdena. Variabler som kan anges vid installationen:
- `REPO_DIR`, `NODE_BIN`, `NPM_BIN`, `BUILD_USER`, `PUBLIC_ORIGIN`, `PORT`
- `INSTALL_ROOT` (under `/opt`), `ENV_FILE`, `UNIT_FILE`, `OFFSITE_UNIT`, `OFFSITE_TIMER`, `PROXY_FILE`
- `HTTP_VHOST`, `APACHE_VHOST`, `SERVICE_USER`, `SERVICE_GROUP`
- `DATA_DIR` (under `/var/lib`), `DB_PATH`, `CONFIG_BACKUP_ROOT`, `KEEP_PREVIOUS`, `CERTBOT_EMAIL`

## 8. Data och inloggning

SQLite är källan för all data:
- viner och historik
- användare och sessioner
- inbjudnings- och återställningslänkar
- prenumerationer
- schemaläggarens tillstånd

`data/wines-seed.json` används bara när databasen skapas.

Databasen använder WAL. Kopiera inte bara `vin.db` under drift. Använd backuperna, eller stoppa tjänsten och hantera `vin.db`, `-wal` och `-shm` tillsammans.

**Sessioner:**
- Sessionerna lagras hashade i databasen, inte i separata filer, och gäller i `SESSION_DAYS` (30) dagar.
- Byte av lösenord loggar ut användarens andra sessioner.
- Länkar för nytt lösenord och borttagning av användare loggar ut alla deras sessioner.

Logga ut alla:

```bash
sudo runuser -u vinkallaren -- /usr/local/bin/node --disable-warning=ExperimentalWarning --input-type=module \
  -e "import {DatabaseSync} from 'node:sqlite'; new DatabaseSync('/var/lib/vinkallaren/vin.db').exec('DELETE FROM sessions')"
```

**Användare:** administratörer hanterar dem på sidan Admin. Ett nytt lösenord från kommandoraden, som också loggar ut användaren:

```bash
cd /opt/vinkallaren/app && sudo runuser -u vinkallaren -- env DB_PATH=/var/lib/vinkallaren/vin.db \
  /usr/local/bin/node --disable-warning=ExperimentalWarning scripts/add-user.js namn@exempel.se "Namn" [--admin]
```

## 9. Lokal automatisk backup

Backupen sköts inuti Node-tjänsten:
- **Första gången:** direkt när ingen backup finns.
- **Därefter:** dagligen från kl. 03.00 Europe/Stockholm. Schemat kontrolleras varje minut.
- **Efter fel:** minst en timmes väntan innan nästa försök. Felet visas på sidan Admin.

Varje backup är en katalog `backups/vin-YYYYMMDD-HHMMSS/` med två filer:
- `vin.db`, en konsistent kopia gjord med SQLites `VACUUM INTO`, säker under drift
- `manifest.json` med schemaversion, storlek, sha256 och antal viner och användare

Ofärdiga backuper ligger tillfälligt som `.partial` och listas, laddas ned och kopieras inte. De 30 senaste behålls (`BACKUP_KEEP`).

Sidan Admin, under "Drift", visar:
- hälsokontrollerna
- de senaste backuperna, med nedladdning
- knappen "Ta backup nu"

**Återställning** görs manuellt (avsnitt 13). Det finns ingen återställning från webbläsaren än.

## 10. Extern backup med rsync och systemd-timer

| | |
|---|---|
| Skript | `deploy/vinkallaren-backup-offsite.sh`, installeras som `/opt/vinkallaren/app/deploy/…` |
| Tjänst / timer | `vinkallaren-backup-offsite.service` / `.timer` |
| Tid | 04.45 Europe/Stockholm, `RandomizedDelaySec=15min`, `Persistent=true`. LB3 kör 04.30. |

Tjänsten:
- kör som `vinkallaren` och läser `/etc/vinkallaren.env`
- kopierar bara färdiga `vin-*`-kataloger med rsync, via SSH till fjärrmål
- raderar inget på mottagarsidan, så retention där måste hanteras separat
- skriver status till `backups/offsite.json`, som `/api/health` och sidan Admin läser

Aktivera med samma mål som LB3, men i en egen underkatalog:

```bash
sudo BACKUP_OFFSITE_TARGET=backup@nas.example:/srv/vinkallaren ./deploy/install.sh
sudo BACKUP_OFFSITE_TARGET=/mnt/usb/vinkallaren ./deploy/install.sh   # lokal disk; läggs till i ReadWritePaths
sudo BACKUP_OFFSITE_TARGET= ./deploy/install.sh                       # stäng av
```

SSH-nyckeln för tjänsteanvändaren ligger i `/var/lib/vinkallaren/.ssh/`:

```bash
sudo install -d -o vinkallaren -g vinkallaren -m 700 /var/lib/vinkallaren/.ssh
sudo -u vinkallaren ssh-keygen -t ed25519 -N '' -f /var/lib/vinkallaren/.ssh/id_ed25519
sudo cat /var/lib/vinkallaren/.ssh/id_ed25519.pub   # lägg i mottagarens authorized_keys
```

```bash
sudo systemctl list-timers --all | grep vinkallaren
sudo systemctl start vinkallaren-backup-offsite.service
sudo journalctl -u vinkallaren-backup-offsite.service -n 50 --no-pager
```

Detta är en backup av applikationsdata, inte en fullständig serverbackup. Miljöfilen och TLS-konfigurationen ingår inte.

## 11. E-post

Mejlen gäller inbjudningar (länken gäller 7 dagar), "Glömt lösenord" (2 timmar) och sammanfattningar:
- **Dagliga:** bara när något har hänt.
- **Veckovisa:** måndagar, med viner som bör drickas snart.

Varje sammanfattning har en länk för att avsluta och `List-Unsubscribe`, med stöd för avregistrering med ett klick.

Utan SMTP visar sidan Admin inbjudnings- och återställningslänkarna så att administratören kan skicka dem själv. Lägg in SPF och DKIM för `parnes.com` hos den SMTP-tjänst som används.

## 12. Health endpoint och felsökning

Publik kontroll: `https://vin.parnes.com/api/health`. Den svarar 200 när allt är godkänt och 503 annars.

| Kontroll | Godkänd när |
|---|---|
| `database` | En enkel fråga lyckas |
| `backup` | Det finns en lokal backup som är högst 30 timmar gammal |
| `offsite` | En extern kopia har lyckats inom 30 timmar, eller `"status": "off"` om ingen är inställd |
| `disk` | Minst 500 MB ledigt i datakatalogen |

```bash
/usr/local/bin/node --version
sudo systemctl status vinkallaren --no-pager
sudo journalctl -u vinkallaren -n 100 --no-pager
sudo ss -ltnp | grep -E '310[34]'
sudo apache2ctl configtest && sudo apache2ctl -S
curl --fail --show-error http://127.0.0.1:3104/api/public
curl --show-error https://vin.parnes.com/api/health
cat /opt/vinkallaren/app/REVISION
```

**Felsökning:**
- **Lokalt fungerar men inte publikt:** kontrollera vhost, include, TLS och DNS.
- **Båda fallerar:** börja med journalen, miljöfilen, Node-versionen och rättigheterna i `/var/lib/vinkallaren`.

Skriv inte ut hemliga värden ur miljöfilen i delade loggar:

```bash
sudo sed 's/=.*//' /etc/vinkallaren.env   # bara nycklarna
```

## 13. Rollback och återställning

Det finns tre backupkategorier, och de ska hållas isär:

| | |
|---|---|
| A. Applikationsversion | `/opt/vinkallaren/app.previous.<tid>` |
| B. Installationskonfiguration | `/var/backups/vinkallaren/install-<tid>/` |
| C. Data | `/var/lib/vinkallaren/backups/vin-*/` (och den externa kopian) |

**Kodrollback:**

```bash
sudo systemctl stop vinkallaren
sudo mv /opt/vinkallaren/app /opt/vinkallaren/app.broken.$(date -u +%Y%m%dT%H%M%SZ)
sudo mv /opt/vinkallaren/app.previous.<tid> /opt/vinkallaren/app
sudo systemctl start vinkallaren
```

Databasen migreras bara framåt (`PRAGMA user_version`). En äldre kodversion fungerar därför med en nyare databas bara om ingen migrering har tillkommit däremellan. Kontrollera `server/db.js`.

**Databasåterställning:**

```bash
sudo systemctl stop vinkallaren
cd /var/lib/vinkallaren
sudo -u vinkallaren mkdir -p restore-saved && sudo -u vinkallaren mv vin.db vin.db-wal vin.db-shm restore-saved/ 2>/dev/null
sudo -u vinkallaren sha256sum backups/vin-<tid>/vin.db   # jämför med manifest.json
sudo -u vinkallaren cp backups/vin-<tid>/vin.db vin.db
sudo systemctl start vinkallaren
```

En databasåterställning återställer inte miljöfilen, TLS eller den installerade koden. Användare och sessioner följer med databasen.

## 14. Skillnader mot LB3

| | LB3 | Vinkällaren |
|---|---|---|
| Port | 3103 | 3104 |
| Apache | Include i befintlig vhost, statisk DocumentRoot och proxy för `/admin` och `/api/catalog` | Egen vhost, allt proxas till Node |
| Frontend | Vite-bygge, publiceras till DocumentRoot | Statiska filer som Node serverar, inget bygge |
| Admin-inloggning | Ett konto via `ADMIN_PASSWORD_HASH`, med TOTP | Flera användare i databasen, administratörsroll, inbjudningar |
| Sessioner | `admin-sessions.json` | Tabellen `sessions` i databasen. Lösenordsbyte loggar ut andra sessioner. |
| Backup | Databas, bilder, tar.gz och återställning i Admin | Databas och manifest. Nedladdning i Admin, återställning manuellt. |
| Offsite | 04.30 | 04.45 |
| HTTP-ramverk | Eget | Express |

## 15. Verifiera på den faktiska servern

- [ ] Att port 3104 är ledig: `sudo ss -ltnp`.
- [ ] Att `/usr/local/bin/node` är Node 24 och att `parnes` kan köra `npm ci` i `/home/parnes/work/vin`.
- [ ] Att DNS för `vin.parnes.com` pekar på servern och att port 80 och 443 är öppna i brandväggen.
- [ ] Att certbot har ett konto (det har det troligen, för LB3) och att förnyelsen fungerar: `sudo certbot renew --dry-run`.
- [ ] Att den skapade HTTPS-vhosten heter `vin.parnes.com-le-ssl.conf`. Ange annars `APACHE_VHOST=…`.
- [ ] Att `apache2ctl -S` visar `vin.parnes.com` på både *:80 och *:443, och att LB3:s vhostar är opåverkade.
- [ ] Vilken SMTP som ska användas (samma som LB3?), samt SPF och DKIM för `parnes.com`.
- [ ] Mål för extern backup (samma NAS som LB3, egen underkatalog) och SSH-nyckel för `vinkallaren`.
- [ ] Efter ett dygn: att `/api/health` svarar 200 och att `offsite.json` visar en lyckad kopia.
- [ ] En provåterställning av en backup till en temporär katalog.
