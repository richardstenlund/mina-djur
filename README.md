# Mina djur

Webbapp för att hålla koll på katter och smådjur: vikt, kloklippning,
veterinärbesök, medicin, vaccinationer, pälsvård och egna anteckningar.
Flera personer kan skapa varsitt konto – varje användare ser bara sina
egna djur.

## Köra med Docker

1. Kopiera miljömallen och fyll i egna värden:

   ```powershell
   Copy-Item .env.example .env
   ```

   Öppna `.env` och sätt ett starkt `POSTGRES_PASSWORD` och en slumpad
   `SESSION_SECRET` (t.ex. `openssl rand -hex 32`).

2. Bygg och starta:

   ```powershell
   docker compose up -d --build
   ```

3. Öppna `http://<din-docker-host>:4300` (porten styrs av `APP_PORT` i `.env`).
   Skapa ett konto på registreringssidan och logga in.

   > Kör du appen bakom en HTTPS-reverse proxy (Nginx/Traefik med TLS)?
   > Sätt då `COOKIE_SECURE=true` i `.env` för säkrare cookies. Kör du bara
   > direkt över `http://`, låt den vara `false` (standard) annars fungerar
   > inte inloggningen.

Databasen (Postgres) körs i en egen container med en Docker-volym
(`db_data`) så att all data — användare, djur och anteckningar — sparas
mellan omstarter och uppdateringar.

## Uppdatera appen

```powershell
docker compose pull   # om du hämtar en ny image
docker compose up -d --build
```

Databasen påverkas inte av att app-containern byggs om.

## Säkerhetskopiering

```powershell
docker compose exec db pg_dump -U minadjur minadjur > backup.sql
```

## Utveckling utan Docker (valfritt)

```powershell
cd app
npm install
$env:PGHOST = "localhost"
$env:PGPORT = "5432"
$env:PGUSER = "minadjur"
$env:PGPASSWORD = "losenord"
$env:PGDATABASE = "minadjur"
$env:SESSION_SECRET = "en-lang-hemlighet"
npm start
```

Kräver en lokalt körande Postgres-databas med schemat från
`app/db/init.sql` inläst.

## Struktur

- `app/server.js` – Express-server, sessioner (lagras i Postgres via
  `connect-pg-simple`), säkerhetsheaders.
- `app/routes/auth.js` – registrering, inloggning, utloggning.
- `app/routes/animals.js` – API för djur och deras historik, alltid
  filtrerat på inloggad användares `user_id` så att ingen kan se någon
  annans djur.
- `app/db/init.sql` – databasschema som körs automatiskt första gången
  Postgres-containern startar.
- `app/public/` – frontend (login, registrering, huvudsidan).
