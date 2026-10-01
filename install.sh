#!/usr/bin/env bash
set -eu

cd "$(dirname "$0")"

if ! command -v docker >/dev/null 2>&1; then
	echo "Fel: Docker saknas. Installera Docker Engine och försök igen." >&2
	exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
	echo "Fel: Docker Compose v2 saknas. Installera Compose-pluginet och försök igen." >&2
	exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
	echo "Fel: openssl saknas och behövs för att skapa säkra lösenord." >&2
	exit 1
fi

if [ -e .env ]; then
	echo "Fel: .env finns redan. Installationen avbröts för att inte skriva över dina inställningar." >&2
	echo "Vid en befintlig installation använder du i stället: git pull && docker compose up -d --build" >&2
	exit 1
fi

app_port=4300
if [ -t 0 ]; then
	read -r -p "Vilken port ska sidan använda? [4300]: " entered_port
	app_port=${entered_port:-4300}
fi

if [[ ! "$app_port" =~ ^[0-9]{1,5}$ ]]; then
	echo "Fel: porten måste vara ett nummer mellan 1 och 65535." >&2
	exit 1
fi
port_number=$((10#$app_port))
if ((port_number < 1 || port_number > 65535)); then
	echo "Fel: porten måste vara ett nummer mellan 1 och 65535." >&2
	exit 1
fi
app_port=$port_number

postgres_password=$(openssl rand -hex 32)
session_secret=$(openssl rand -hex 32)
umask 077
cat > .env <<EOF
POSTGRES_DB=minadjur
POSTGRES_USER=minadjur
POSTGRES_PASSWORD=$postgres_password
SESSION_SECRET=$session_secret
COOKIE_SECURE=false
APP_PORT=$app_port
EOF

echo "Skapar databasen och startar Mina djur på port $app_port..."
if ! docker compose up -d --build; then
	echo "Installationen misslyckades. Kontrollera Docker-utdata ovan och kör sedan:" >&2
	echo "  docker compose logs --tail=100 app" >&2
	exit 1
fi

echo
echo "Klart! Öppna sidan på http://SERVERNS-IP:$app_port"
echo "Skapa ditt konto på registreringssidan."
echo "Dina hemligheter finns sparade i .env. Spara en säkerhetskopia av filen."
