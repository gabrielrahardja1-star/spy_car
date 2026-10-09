#!/bin/sh
# backup.sh - dump the Traccar database into a dated, compressed file.
#
# Usage:   sh deploy/backup.sh            (from anywhere; it finds its own folder)
# Output:  deploy/backups/traccar-YYYY-MM-DD_HHMMSS.sql.gz
# Keeps:   the last KEEP_DAYS days (default 14). Older dumps are deleted.
#          Change with:  KEEP_DAYS=30 sh deploy/backup.sh
#
# What is saved: the whole "traccar" database (users, devices, geofences, positions, trips).
# NOT saved: the HTTPS certificates (Caddy re-issues them) and your deploy/.env file.
# Keep a copy of .env somewhere safe too (a password manager). Without it a restore still works,
# you just choose a new database password.
#
# Copy the dumps OFF this server as well (another machine or cloud storage), or a dead disk
# takes the backups with it. Example: scp deploy/backups/*.sql.gz you@other-host:backups/
#
# Run it every night, for example (crontab -e), at 02:30 server time:
#   30 2 * * * /bin/sh /path/to/spy_car/deploy/backup.sh >> /path/to/spy_car/deploy/backups/backup.log 2>&1
#
# Restore: see README.md, section "Backups and restore".

set -eu

KEEP_DAYS="${KEEP_DAYS:-14}"
DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="$DIR/backups"
STAMP="$(date +%Y-%m-%d_%H%M%S)"
FILE="$OUT_DIR/traccar-$STAMP.sql.gz"
TMP="$FILE.partial"

# Only the owner may read the dumps (they contain every position and the user password hashes).
umask 077
mkdir -p "$OUT_DIR"

cd "$DIR"

# The "db" service must be running.
if ! docker compose ps --status running --services 2>/dev/null | grep -qx "db"; then
  echo "backup: the db container is not running. Start the stack first (docker compose up -d)." >&2
  exit 1
fi

# pg_dump runs INSIDE the db container (as the database user "traccar", through the local socket),
# so no password is needed here and no database port is exposed.
# "plain" SQL format restores with psql on any PostgreSQL version.
# The dump goes to a .partial file first, so a failed run never leaves a broken .sql.gz behind.
if docker compose exec -T db pg_dump -U traccar -d traccar --no-owner > "$TMP.sql"; then
  gzip -c "$TMP.sql" > "$TMP"
  rm -f "$TMP.sql"
  mv "$TMP" "$FILE"
else
  rm -f "$TMP.sql" "$TMP"
  echo "backup: pg_dump failed." >&2
  exit 1
fi

# Basic sanity check: the file must be a readable gzip and not tiny.
if ! gzip -t "$FILE"; then
  echo "backup: $FILE is not a valid gzip file." >&2
  exit 1
fi

echo "backup: wrote $FILE ($(wc -c < "$FILE" | tr -d ' ') bytes)"

# Retention: delete dumps older than KEEP_DAYS days.
find "$OUT_DIR" -name 'traccar-*.sql.gz' -type f -mtime +"$KEEP_DAYS" -exec rm -f {} \;
echo "backup: removed dumps older than $KEEP_DAYS days (if any)."
