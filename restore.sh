#!/usr/bin/env bash
# Ã…terstÃ¤ller en sÃ¤kerhetskopia skapad av backup.sh.
# Skriver Ã¶ver nuvarande databas och uppladdade filer, sÃ¥ frÃ¥ga om
# bekrÃ¤ftelse innan den kÃ¶r.
#
# AnvÃ¤ndning:
#   ./restore.sh backups/db-20260101-030000.sql.gz backups/uploads-20260101-030000.tar.gz
set -eu

cd "$(dirname "$0")"

if [ $# -ne 2 ]; then
	echo "AnvÃ¤ndning: $0 <db-backup.sql.gz> <uploads-backup.tar.gz>" >&2
	exit 1
fi

db_backup=$1
uploads_backup=$2

if [ ! -e "$db_backup" ]; then
	echo "Fel: hittar inte $db_backup" >&2
	exit 1
fi
if [ ! -e "$uploads_backup" ]; then
	echo "Fel: hittar inte $uploads_backup" >&2
	exit 1
fi
if [ ! -e .env ]; then
	echo "Fel: .env saknas. KÃ¶r frÃ¥n mappen dÃ¤r du installerade Mina djur." >&2
	exit 1
fi

# shellcheck disable=SC1091
set -a; source .env; set +a

echo "VARNING: Detta skriver Ã¶ver den nuvarande databasen och alla uppladdade filer"
echo "med innehÃ¥llet frÃ¥n:"
echo "  $db_backup"
echo "  $uploads_backup"
read -r -p "Ã„r du sÃ¤ker pÃ¥ att du vill fortsÃ¤tta? Skriv 'ja' fÃ¶r att bekrÃ¤fta: " confirm
if [ "$confirm" != "ja" ]; then
	echo "Avbrutet. Ingenting har Ã¤ndrats."
	exit 0
fi

echo "Ã…terstÃ¤ller databasen..."
gunzip -c "$db_backup" | docker compose exec -T db psql -U "$POSTGRES_USER" "$POSTGRES_DB"

echo "Ã…terstÃ¤ller uppladdade filer..."
docker compose exec -T app sh -c 'rm -rf /usr/src/app/uploads/* 2>/dev/null; true'
cat "$uploads_backup" | docker compose exec -T app tar xzf - -C /usr/src/app

echo "Klart. Startar om appen sÃ¥ den lÃ¤ser in den Ã¥terstÃ¤llda datan..."
docker compose restart app

echo "Ã…terstÃ¤llningen Ã¤r klar."
