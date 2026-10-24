#!/bin/bash
# Copies finished backups to BACKUP_OFFSITE_TARGET with rsync (same model as LB3).
#   BACKUP_OFFSITE_TARGET=backup@nas.example:/srv/vinkallaren   (SSH, key in /var/lib/vinkallaren/.ssh/)
#   BACKUP_OFFSITE_TARGET=/mnt/usb/vinkallaren                  (local disk)
# Nothing is deleted on the receiving side; retention there is handled separately.
# Status is written to $BACKUP_DIR/offsite.json and read by /api/health and the Admin page.
set -euo pipefail

DB_PATH=${DB_PATH:-/var/lib/vinkallaren/vin.db}
BACKUP_DIR=${BACKUP_DIR:-$(dirname "$DB_PATH")/backups}
TARGET=${BACKUP_OFFSITE_TARGET:-}
STATUS="$BACKUP_DIR/offsite.json"

if [ -z "$TARGET" ]; then
  echo "BACKUP_OFFSITE_TARGET är inte satt, inget att kopiera."
  exit 0
fi
if [ ! -d "$BACKUP_DIR" ]; then
  echo "Backupkatalogen $BACKUP_DIR finns inte." >&2
  exit 1
fi

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
json_str() { printf '"%s"' "$(printf '%s' "$1" | tr -d '"\\' | tr '\n\r\t' '   ' | cut -c1-300)"; }
previous_success=$(sed -n 's/.*"lastSuccess": *"\([^"]*\)".*/\1/p' "$STATUS" 2>/dev/null || true)

write_status() { # ok(true|false) lastSuccess error
  local tmp success=null error=null
  [ -n "$2" ] && success="\"$2\""
  [ -n "$3" ] && error=$(json_str "$3")
  tmp=$(mktemp "$BACKUP_DIR/.offsite.XXXXXX")
  printf '{"target":%s,"lastAttempt":"%s","lastSuccess":%s,"ok":%s,"error":%s}\n' \
    "$(json_str "$TARGET")" "$(now)" "$success" "$1" "$error" > "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$STATUS"
}

errfile=$(mktemp)
trap 'rm -f "$errfile"' EXIT
# Only complete backup directories: skip *.partial, status files and anything else.
if rsync -a --exclude='*.partial' --include='vin-*/***' --exclude='*' \
     -e 'ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new' \
     "$BACKUP_DIR/" "$TARGET/" 2>"$errfile"; then
  write_status true "$(now)" ""
  echo "Kopierade backuper till $TARGET."
else
  code=$?
  write_status false "$previous_success" "rsync avslutade med kod $code: $(tail -n 3 "$errfile")"
  cat "$errfile" >&2
  exit "$code"
fi
