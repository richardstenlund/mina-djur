#!/usr/bin/env bash
# Tar en sÃ¤kerhetskopia av databasen och alla uppladdade filer (bilder/dokument).
# KÃ¶rs enklast via cron, t.ex. en gÃ¥ng per natt:
#   0 3 * * * /sÃ¶kvÃ¤g/till/mina-djur/backup.sh >> /sÃ¶kvÃ¤g/till/mina-djur/backups/backup.log 2>&1
set -eu

cd "$(dirname "$0")"

if [ ! -e .env ]; then
	echo "Fel: .env saknas. KÃ¶r frÃ¥n mappen dÃ¤r du installerade Mina djur." >&2
	exit 1
fi

# shellcheck disable=SC1091
set -a; source .env; set +a

if ! docker compose ps db >/dev/null 2>&1; then
	echo "Fel: kunde inte nÃ¥ docker compose. Ã„r tjÃ¤nsterna igÃ¥ng (docker compose up -d)?" >&2
	exit 1
fi

mkdir -p backups
timestamp=$(date +%Y%m%d-%H%M%S)
db_file="backups/db-$timestamp.sql.gz"
uploads_file="backups/uploads-$timestamp.tar.gz"

echo "SÃ¤kerhetskopierar databasen till $db_file ..."
docker compose exec -T db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "$db_file"

echo "SÃ¤kerhetskopierar uppladdade filer till $uploads_file ..."
docker compose exec -T app tar czf - -C /usr/src/app uploads > "$uploads_file"

# Rensa bort sÃ¤kerhetskopior Ã¤ldre Ã¤n 30 dagar sÃ¥ disken inte fylls Ã¶ver tid.
find backups -maxdepth 1 -type f \( -name "db-*.sql.gz" -o -name "uploads-*.tar.gz" \) -mtime +30 -delete 2>/dev/null || true

echo "Klart."
echo "  $db_file"
echo "  $uploads_file"
echo
echo "Tips: spara backups-mappen nÃ¥gon annanstans ocksÃ¥ (t.ex. en annan server eller molnlagring)."
echo "En kopia pÃ¥ samma disk skyddar inte mot diskhaveri."
