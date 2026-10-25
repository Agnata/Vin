#!/bin/bash
# Installs or upgrades Vinkällaren on the server. Same model as LB3's server/deploy/install.sh:
# root-owned code in /opt, data in /var/lib, config in /etc, Apache in front.
#
#   cd /home/parnes/work/Vin && git pull
#   ./deploy/install.sh --check        # validate only, no changes (no sudo needed)
#   sudo ./deploy/install.sh           # install / upgrade
#
# Flags:
#   --check          Validate prerequisites and exit.
#   --create-admin   Create an administrator even if one exists (interactive).
#   --skip-tests     Do not run the test suite before installing.
#   --no-certbot     Never run certbot; fail with instructions if no HTTPS vhost exists.
#
# Every path and name below can be overridden from the environment, e.g.
#   sudo PORT=3105 ./deploy/install.sh
#   sudo BACKUP_OFFSITE_TARGET=backup@nas.example:/srv/vinkallaren ./deploy/install.sh
#   sudo BACKUP_OFFSITE_TARGET= ./deploy/install.sh          # explicitly turn offsite copying off
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_DIR=${REPO_DIR:-$(dirname "$SCRIPT_DIR")}
NODE_BIN=${NODE_BIN:-/usr/local/bin/node}
NPM_BIN=${NPM_BIN:-/usr/local/bin/npm}
BUILD_USER=${BUILD_USER:-parnes}
PUBLIC_ORIGIN=${PUBLIC_ORIGIN:-https://vin.parnes.com}
PORT=${PORT:-3104}
INSTALL_ROOT=${INSTALL_ROOT:-/opt/vinkallaren}
APP_DIR="$INSTALL_ROOT/app"
ENV_FILE=${ENV_FILE:-/etc/vinkallaren.env}
UNIT_FILE=${UNIT_FILE:-/etc/systemd/system/vinkallaren.service}
OFFSITE_UNIT=${OFFSITE_UNIT:-/etc/systemd/system/vinkallaren-backup-offsite.service}
OFFSITE_TIMER=${OFFSITE_TIMER:-/etc/systemd/system/vinkallaren-backup-offsite.timer}
PROXY_FILE=${PROXY_FILE:-/etc/apache2/vinkallaren-proxy.conf}
SERVICE_USER=${SERVICE_USER:-vinkallaren}
SERVICE_GROUP=${SERVICE_GROUP:-vinkallaren}
DATA_DIR=${DATA_DIR:-/var/lib/vinkallaren}
DB_PATH=${DB_PATH:-$DATA_DIR/vin.db}
CONFIG_BACKUP_ROOT=${CONFIG_BACKUP_ROOT:-/var/backups/vinkallaren}
KEEP_PREVIOUS=${KEEP_PREVIOUS:-5}
CERTBOT_EMAIL=${CERTBOT_EMAIL:-}

SERVER_NAME=${PUBLIC_ORIGIN#https://}
HTTP_VHOST=${HTTP_VHOST:-/etc/apache2/sites-available/$SERVER_NAME.conf}
APACHE_VHOST=${APACHE_VHOST:-/etc/apache2/sites-available/$SERVER_NAME-le-ssl.conf}
SERVICE_NAME=$(basename "$UNIT_FILE" .service)
git_repo() { git -c safe.directory="$REPO_DIR" -C "$REPO_DIR" "$@"; }
OFFSITE_NAME=$(basename "$OFFSITE_TIMER")
# Was BACKUP_OFFSITE_TARGET given explicitly (even empty)? Otherwise keep what the env file has.
OFFSITE_EXPLICIT=${BACKUP_OFFSITE_TARGET+yes}
OFFSITE_ARG=${BACKUP_OFFSITE_TARGET-}

CHECK=no; CREATE_ADMIN=no; SKIP_TESTS=no; NO_CERTBOT=no
for arg in "$@"; do
  case "$arg" in
    --check) CHECK=yes ;;
    --create-admin) CREATE_ADMIN=yes ;;
    --skip-tests) SKIP_TESTS=yes ;;
    --no-certbot) NO_CERTBOT=yes ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "Okänd flagga: $arg" >&2; exit 2 ;;
  esac
done

TS=$(date -u +%Y%m%dT%H%M%SZ)
step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
ok() { printf '   ok  %s\n' "$*"; }
warn() { printf '   !   %s\n' "$*" >&2; }
die() { printf '\nFEL: %s\n' "$*" >&2; exit 1; }
as_build() { runuser -u "$BUILD_USER" -- env PATH="$(dirname "$NODE_BIN"):/usr/bin:/bin" HOME="$(getent passwd "$BUILD_USER" | cut -d: -f6)" "$@"; }
as_service() { runuser -u "$SERVICE_USER" -- bash -c 'umask 077; exec "$@"' _ env DB_PATH="$DB_PATH" "$NODE_BIN" --disable-warning=ExperimentalWarning "$@"; }
fill() { # template -> stdout with @VARS@ replaced
  sed -e "s#@PUBLIC_ORIGIN@#$PUBLIC_ORIGIN#g" -e "s#@SERVER_NAME@#$SERVER_NAME#g" -e "s#@PORT@#$PORT#g" \
      -e "s#@SERVICE_USER@#$SERVICE_USER#g" -e "s#@SERVICE_GROUP@#$SERVICE_GROUP#g" -e "s#@APP_DIR@#$APP_DIR#g" \
      -e "s#@ENV_FILE@#$ENV_FILE#g" -e "s#@NODE_BIN@#$NODE_BIN#g" -e "s#@DATA_DIR@#$DATA_DIR#g" \
      -e "s#@VHOST_ADDR@#${VHOST_ADDR:-*}#g" -e "s#@STATE_DIR_NAME@#${DATA_DIR#/var/lib/}#g" -e "s#@OFFSITE_RW_PATHS@#${OFFSITE_RW_PATHS:-$DATA_DIR}#g" "$1"
}
env_value() { # key -> value from the existing env file (quotes stripped), empty if missing
  [ -r "$ENV_FILE" ] || return 0
  sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"
}

# ---------------------------------------------------------------- 1. validate
step "Kontrollerar förutsättningar"
[[ "$PUBLIC_ORIGIN" =~ ^https://[a-z0-9.-]+$ ]] || die "PUBLIC_ORIGIN måste vara https://värdnamn utan avslutande snedstreck (nu: $PUBLIC_ORIGIN)."
[[ "$PORT" =~ ^[0-9]+$ ]] && [ "$PORT" -ge 1024 ] && [ "$PORT" -le 65535 ] || die "Ogiltig PORT: $PORT"
[[ "$DATA_DIR" == /var/lib/* ]] || die "DATA_DIR måste ligga under /var/lib (systemd StateDirectory)."
[[ "$INSTALL_ROOT" == /opt/* ]] || die "INSTALL_ROOT måste ligga under /opt."
[ -f "$REPO_DIR/package.json" ] && [ -f "$REPO_DIR/server/app.js" ] || die "$REPO_DIR ser inte ut som Vinkällarens repo."
ok "Repo: $REPO_DIR ($(git_repo rev-parse --short HEAD 2>/dev/null || echo "okänd commit"))"

[ -x "$NODE_BIN" ] || die "Node saknas: $NODE_BIN"
"$NODE_BIN" -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' \
  || die "Node $("$NODE_BIN" --version) är för gammal; node:sqlite kräver minst 22.13."
[ -x "$NPM_BIN" ] || die "npm saknas: $NPM_BIN"
ok "Node $("$NODE_BIN" --version), npm $("$NPM_BIN" --version 2>/dev/null)"

id "$BUILD_USER" >/dev/null 2>&1 || die "Bygganvändaren $BUILD_USER finns inte."
ok "Bygganvändare: $BUILD_USER"

for cmd in apache2ctl a2enmod a2query a2ensite systemctl curl ss runuser install; do
  command -v "$cmd" >/dev/null || die "Kommandot $cmd saknas."
done
ok "Systemkommandon finns"

listener=$(ss -ltnpH "sport = :$PORT" 2>/dev/null || true)
if [ -n "$listener" ] && ! systemctl is-active --quiet "$SERVICE_NAME"; then
  die "Port $PORT används redan av något annat: $listener (LB3 använder 3103). Välj en annan med PORT=…"
fi
ok "Port $PORT är ledig eller används av $SERVICE_NAME"

# Name-based vhosts only compete with others on the same address. If the server's other HTTPS
# sites are bound to a specific IP (e.g. <VirtualHost www.parnes.com:443> = 192.168.2.80:443),
# a *:443 vhost is never chosen for traffic to that IP, so use the same address.
if [ -z "${VHOST_ADDR:-}" ]; then
  VHOST_ADDR=$(apache2ctl -S 2>/dev/null | sed -n 's/^\([0-9][0-9.]*\):443 \{1,\}is a NameVirtualHost.*/\1/p' | head -n 1)
  VHOST_ADDR=${VHOST_ADDR:-*}
fi
ok "Vhost-adress: $VHOST_ADDR (samma som övriga HTTPS-sajter; ändra med VHOST_ADDR=…)"

if [ -f "$APACHE_VHOST" ]; then ok "HTTPS-vhost: $APACHE_VHOST"
elif [ "$NO_CERTBOT" = yes ]; then die "HTTPS-vhosten $APACHE_VHOST saknas. Skapa den (certbot --apache -d $SERVER_NAME) eller ange APACHE_VHOST=…"
else
  command -v certbot >/dev/null || die "HTTPS-vhosten $APACHE_VHOST saknas och certbot finns inte."
  warn "HTTPS-vhosten saknas; den skapas med certbot (kräver att DNS för $SERVER_NAME pekar hit)."
fi

if [ "$OFFSITE_EXPLICIT" = yes ]; then OFFSITE_TARGET=$OFFSITE_ARG; else OFFSITE_TARGET=$(env_value BACKUP_OFFSITE_TARGET); fi
if [ -n "$OFFSITE_TARGET" ]; then
  command -v rsync >/dev/null || die "BACKUP_OFFSITE_TARGET är satt men rsync saknas (apt install rsync)."
  ok "Extern backup till $OFFSITE_TARGET"
else
  ok "Extern backup: av"
fi

if [ "$CHECK" = yes ]; then
  echo; echo "Kontrollen är klar. Inget har ändrats."
  exit 0
fi
[ "$(id -u)" = 0 ] || die "Kör installationen med sudo (eller lägg till --check)."

# ---------------------------------------------------------------- 2. build and test
step "Installerar beroenden och kör tester som $BUILD_USER"
as_build bash -c "cd '$REPO_DIR' && '$NPM_BIN' ci --omit=dev --ignore-scripts --no-audit --no-fund"
if [ "$SKIP_TESTS" = no ]; then
  as_build bash -c "cd '$REPO_DIR' && '$NPM_BIN' test" >/dev/null 2>&1 || {
    as_build bash -c "cd '$REPO_DIR' && '$NPM_BIN' test" | tail -n 40
    die "Testerna misslyckades. Inget är installerat."
  }
  ok "Testerna gick igenom"
fi

# ---------------------------------------------------------------- 3. back up configuration
step "Säkerhetskopierar konfiguration"
CFG_BACKUP="$CONFIG_BACKUP_ROOT/install-$TS"
install -d -m 700 "$CFG_BACKUP"
for f in "$ENV_FILE" "$UNIT_FILE" "$OFFSITE_UNIT" "$OFFSITE_TIMER" "$PROXY_FILE" "$HTTP_VHOST" "$APACHE_VHOST"; do
  [ -f "$f" ] && cp -a "$f" "$CFG_BACKUP/"
done
ok "$CFG_BACKUP"

# ---------------------------------------------------------------- 4. service user and data dir
step "Tjänsteanvändare och datakatalog"
getent group "$SERVICE_GROUP" >/dev/null || groupadd --system "$SERVICE_GROUP"
id "$SERVICE_USER" >/dev/null 2>&1 || useradd --system --gid "$SERVICE_GROUP" --home-dir "$DATA_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
install -d -o "$SERVICE_USER" -g "$SERVICE_GROUP" -m 750 "$DATA_DIR"
install -d -o "$SERVICE_USER" -g "$SERVICE_GROUP" -m 700 "$DATA_DIR/backups"
ok "$SERVICE_USER:$SERVICE_GROUP, $DATA_DIR"

# ---------------------------------------------------------------- 5. stage and swap the app
step "Installerar applikationen i $APP_DIR"
STAGE="$INSTALL_ROOT/app.staging-$TS"
install -d -m 755 "$INSTALL_ROOT"
rm -rf "$STAGE"; mkdir "$STAGE"
for p in package.json package-lock.json server public scripts data deploy node_modules; do
  cp -a "$REPO_DIR/$p" "$STAGE/"
done
rm -rf "$STAGE/.env" "$STAGE"/*.db "$STAGE"/*.db-*
git_repo rev-parse HEAD > "$STAGE/REVISION" 2>/dev/null || true
chown -R root:root "$STAGE"
chmod -R u=rwX,go=rX "$STAGE"
chmod 755 "$STAGE/deploy/"*.sh
# Runs app and npm code, so it runs as the service user, never as root.
(cd "$STAGE" && as_service --input-type=module \
  -e "await import('./server/app.js'); const { DatabaseSync } = await import('node:sqlite'); new DatabaseSync(':memory:').exec('select 1');") \
  || { rm -rf "$STAGE"; die "Den nya versionen startar inte (import/node:sqlite). Inget är bytt."; }
ok "Kontrollerad i $STAGE"
if [ -d "$APP_DIR" ]; then
  mv "$APP_DIR" "$INSTALL_ROOT/app.previous.$TS"
  ok "Föregående version: $INSTALL_ROOT/app.previous.$TS"
fi
mv "$STAGE" "$APP_DIR"
# Keep the newest KEEP_PREVIOUS previous versions.
find "$INSTALL_ROOT" -maxdepth 1 -name 'app.previous.*' | sort -r | tail -n +$((KEEP_PREVIOUS + 1)) | xargs -r rm -rf

# ---------------------------------------------------------------- 6. environment file
step "Skriver $ENV_FILE"
declare -A MANAGED=(
  [NODE_ENV]=production [HOST]=127.0.0.1 [PORT]=$PORT [PUBLIC_ORIGIN]=$PUBLIC_ORIGIN
  [DB_PATH]=$DB_PATH [COOKIE_SECURE]=true [BACKUP_OFFSITE_TARGET]=$OFFSITE_TARGET
)
MANAGED_ORDER=(NODE_ENV HOST PORT PUBLIC_ORIGIN DB_PATH COOKIE_SECURE BACKUP_OFFSITE_TARGET)
# Written only when missing; existing values (API keys, SMTP, …) are always kept.
DEFAULTS=(
  'MAIL_FROM="Vinkällaren <vin@parnes.com>"' 'SMTP_HOST=' 'SMTP_PORT=587' 'SMTP_SECURE=false' 'SMTP_USER=' 'SMTP_PASS='
  'PUBLIC_STATS=true' 'SESSION_DAYS=30' 'BACKUP_KEEP=30'
  'CLAUDE_ENABLED=false' 'ANTHROPIC_API_KEY=' 'CLAUDE_MODEL=claude-opus-5-5'
)
tmp_env=$(mktemp)
declare -A seen=()
if [ -f "$ENV_FILE" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)= ]] || continue   # comments are not kept (as in LB3)
    key=${BASH_REMATCH[1]}
    [ -n "${MANAGED[$key]+x}" ] && continue
    [ -n "${seen[$key]+x}" ] && continue
    seen[$key]=1
    printf '%s\n' "$line" >> "$tmp_env"
  done < "$ENV_FILE"
fi
for key in "${MANAGED_ORDER[@]}"; do printf '%s=%s\n' "$key" "${MANAGED[$key]}" >> "$tmp_env"; done
for line in "${DEFAULTS[@]}"; do
  key=${line%%=*}
  [ -n "${seen[$key]+x}" ] || printf '%s\n' "$line" >> "$tmp_env"
done
install -o root -g root -m 600 "$tmp_env" "$ENV_FILE"
rm -f "$tmp_env"
ok "root:root 0600 (övriga nycklar bevarade)"

# ---------------------------------------------------------------- 7. data: seed and first admin
step "Databas och administratör"
if [ ! -f "$DB_PATH" ]; then
  (cd "$APP_DIR" && as_service scripts/seed.js)
  ok "Ny databas med vinerna från data/wines-seed.json"
else
  ok "Befintlig databas behålls ($DB_PATH); migreringar körs när tjänsten startar"
fi
has_admin=$(cd "$APP_DIR" && as_service --input-type=module -e "
  import { openDb } from './server/db.js';
  const db = openDb(process.env.DB_PATH);
  console.log(db.prepare('SELECT COUNT(*) AS n FROM users WHERE is_admin = 1').get().n);")
if [ "$has_admin" = 0 ] || [ "$CREATE_ADMIN" = yes ]; then
  [ -t 0 ] || die "En administratör behöver skapas, men terminalen är inte interaktiv. Kör igen direkt i en terminal."
  echo "   Skapa en administratör. Övriga användare bjuder du sedan in från sidan Admin."
  read -r -p "   E-post: " admin_email
  read -r -p "   Namn: " admin_name
  (cd "$APP_DIR" && as_service scripts/add-user.js "$admin_email" "$admin_name" --admin)
  echo "   Logga in och slå på tvåstegsverifiering under Konto; Admin kräver det."
else
  ok "Det finns redan $has_admin administratör(er)"
fi

# ---------------------------------------------------------------- 8. systemd units
step "systemd"
fill "$APP_DIR/deploy/vinkallaren.service" > "$UNIT_FILE"
if [[ "$OFFSITE_TARGET" == /* ]]; then
  OFFSITE_RW_PATHS="$DATA_DIR $OFFSITE_TARGET"
  install -d -o "$SERVICE_USER" -g "$SERVICE_GROUP" -m 700 "$OFFSITE_TARGET"
fi
fill "$APP_DIR/deploy/vinkallaren-backup-offsite.service" > "$OFFSITE_UNIT"
cp "$APP_DIR/deploy/vinkallaren-backup-offsite.timer" "$OFFSITE_TIMER"
chmod 644 "$UNIT_FILE" "$OFFSITE_UNIT" "$OFFSITE_TIMER"
# Units from an earlier, never-released layout of this repo.
for old in vinkallaren-backup.timer vinkallaren-digest.timer vinkallaren-backup.service vinkallaren-digest.service; do
  if [ -f "/etc/systemd/system/$old" ]; then
    systemctl disable --now "$old" 2>/dev/null || true
    rm -f "/etc/systemd/system/$old"
  fi
done
systemctl daemon-reload
systemctl enable "$SERVICE_NAME" >/dev/null
if [ -n "$OFFSITE_TARGET" ]; then
  systemctl enable --now "$OFFSITE_NAME" >/dev/null
  ok "Extern kopiering aktiverad (04:45)"
  [[ "$OFFSITE_TARGET" == /* ]] || [ -f "$DATA_DIR/.ssh/id_ed25519" ] \
    || warn "Skapa en SSH-nyckel: sudo -u $SERVICE_USER ssh-keygen -t ed25519 -N '' -f $DATA_DIR/.ssh/id_ed25519 och lägg publika nyckeln hos mottagaren."
else
  systemctl disable --now "$OFFSITE_NAME" >/dev/null 2>&1 || true
  ok "Extern kopiering avstängd"
fi

# ---------------------------------------------------------------- 9. Apache
step "Apache"
for mod in proxy proxy_http headers ssl; do
  a2query -q -m "$mod" || { a2enmod -q "$mod"; ok "Aktiverade modulen $mod"; }
done
fill "$APP_DIR/deploy/apache.conf" > "$PROXY_FILE"
chmod 644 "$PROXY_FILE"
if [ ! -f "$APACHE_VHOST" ]; then
  if [ ! -f "$HTTP_VHOST" ]; then
    fill "$APP_DIR/deploy/apache-http.conf" > "$HTTP_VHOST"
    a2ensite -q "$(basename "$HTTP_VHOST" .conf)"
    apache2ctl configtest || die "apache2ctl configtest misslyckades efter att $HTTP_VHOST skapades."
    systemctl reload apache2
    ok "Skapade $HTTP_VHOST"
  fi
  if [ -n "$CERTBOT_EMAIL" ]; then certbot_contact=(-m "$CERTBOT_EMAIL"); else certbot_contact=(--register-unsafely-without-email); fi
  certbot --apache -d "$SERVER_NAME" --redirect --non-interactive --agree-tos "${certbot_contact[@]}" \
    || die "certbot misslyckades. Kontrollera DNS för $SERVER_NAME och kör: sudo certbot --apache -d $SERVER_NAME --redirect, sedan installationen igen."
  [ -f "$APACHE_VHOST" ] || die "certbot skapade inte $APACHE_VHOST. Ange rätt fil med APACHE_VHOST=…"
  ok "Certifikat och HTTPS-vhost: $APACHE_VHOST"
fi
# Keep our own vhosts on the same address as the other sites (only these two files are touched).
for pair in "$APACHE_VHOST:443" "$HTTP_VHOST:80"; do
  f=${pair%:*}; port=${pair##*:}
  [ -f "$f" ] || continue
  if grep -qE "<VirtualHost [^>]*:$port>" "$f" && ! grep -qF "<VirtualHost $VHOST_ADDR:$port>" "$f"; then
    sed -i -E "s#<VirtualHost [^>]*:$port>#<VirtualHost $VHOST_ADDR:$port>#" "$f"
    ok "$(basename "$f"): <VirtualHost $VHOST_ADDR:$port>"
  fi
done
if ! grep -q "IncludeOptional $PROXY_FILE" "$APACHE_VHOST"; then
  sed -i "0,/<\/VirtualHost>/s##    IncludeOptional $PROXY_FILE\n</VirtualHost>#" "$APACHE_VHOST"
  ok "Lade till IncludeOptional i $APACHE_VHOST"
fi
if ! apache2ctl configtest 2>/tmp/vinkallaren-configtest.$$; then
  cat /tmp/vinkallaren-configtest.$$ >&2
  for f in "$APACHE_VHOST" "$HTTP_VHOST" "$PROXY_FILE"; do
    if [ -f "$CFG_BACKUP/$(basename "$f")" ]; then cp -a "$CFG_BACKUP/$(basename "$f")" "$f"; else rm -f "$f"; fi
  done
  die "apache2ctl configtest misslyckades. Vhost och proxyfil är återställda; Apache är inte omladdad."
fi
rm -f /tmp/vinkallaren-configtest.$$
ok "configtest ok"

# ---------------------------------------------------------------- 10. start and verify
step "Startar $SERVICE_NAME"
systemctl restart "$SERVICE_NAME"
for i in $(seq 1 30); do
  curl -fs -o /dev/null "http://127.0.0.1:$PORT/api/public" && break
  [ "$i" = 30 ] && {
    systemctl status "$SERVICE_NAME" --no-pager || true
    journalctl -u "$SERVICE_NAME" -n 40 --no-pager || true
    die "Lokalt API svarar inte på 127.0.0.1:$PORT. Apache är inte omladdad. Föregående version finns i $INSTALL_ROOT/app.previous.$TS."
  }
  sleep 1
done
ok "Lokalt API svarar"
systemctl reload apache2
ok "Apache omladdad"

step "Kontrollerar $PUBLIC_ORIGIN"
# Does Apache pick our vhost for this name on the address the other sites use?
if command -v openssl >/dev/null; then
  sni_addr=${VHOST_ADDR/#\*/127.0.0.1}
  san=$(echo | openssl s_client -connect "$sni_addr:443" -servername "$SERVER_NAME" 2>/dev/null | openssl x509 -noout -ext subjectAltName 2>/dev/null || true)
  if grep -q "DNS:$SERVER_NAME" <<<"$san"; then ok "Apache svarar med certifikatet för $SERVER_NAME på $sni_addr:443"
  else warn "Apache svarar INTE med certifikatet för $SERVER_NAME på $sni_addr:443. Jämför vhost-adresserna i: sudo apache2ctl -S"; fi
fi
sleep 6   # let the scheduler take the first backup on a fresh install
code=$(curl -sS --max-time 20 -o /tmp/vinkallaren-health.$$ -w '%{http_code}' "$PUBLIC_ORIGIN/api/health" 2>/tmp/vinkallaren-curl.$$) || true
if [ "$code" = 200 ]; then ok "$PUBLIC_ORIGIN/api/health: 200"
else warn "$PUBLIC_ORIGIN/api/health svarade ${code:-000}: $(cat /tmp/vinkallaren-health.$$ /tmp/vinkallaren-curl.$$ 2>/dev/null | head -c 400)"; fi
rm -f /tmp/vinkallaren-health.$$ /tmp/vinkallaren-curl.$$

echo
echo "Klart. Version $(cat "$APP_DIR/REVISION" 2>/dev/null | cut -c1-7) körs på $PUBLIC_ORIGIN"
echo "Konfiguration sparad i $CFG_BACKUP"
