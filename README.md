# Mina djur

Webbapp för att hålla koll på katter och smådjur: vikt, kloklippning,
veterinärbesök, medicin, vaccinationer, pälsvård och egna anteckningar.
Flera personer kan skapa varsitt konto – varje användare ser bara sina
egna djur. Varje djur har en egen profilsida där du kan ladda upp bilder
och uppdatera informationen.

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
mellan omstarter och uppdateringar. Uppladdade bilder sparas i en egen
volym (`uploads_data`) så de också finns kvar efter en omstart eller
uppdatering.

## Djurprofiler och bilder

Klicka på "Öppna profil" på ett djur för att komma till dess egen sida.
Där kan du:

- ladda upp bilder (JPEG, PNG, WEBP eller GIF, max 8 MB per bild),
- ta bort bilder,
- uppdatera namn, djurart, födelsedatum, startvikt och övrig information,
- lägga till och ta bort skötselanteckningar precis som på startsidan.

Den första uppladdade bilden visas som "omslagsbild" på djurets kort på
startsidan.

## Uppdatera appen

```powershell
docker compose pull   # om du hämtar en ny image
docker compose up -d --build
```

Databasen påverkas inte av att app-containern byggs om. Eventuella
schemaändringar (t.ex. nya tabeller) körs automatiskt vid varje
serverstart, så det räcker med `git pull` + `docker compose up -d --build`
för att få nya funktioner.

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
- `app/routes/animals.js` – API för djur och deras historik och bilder,
  alltid filtrerat på inloggad användares `user_id` så att ingen kan se
  någon annans djur.
- `app/db/init.sql` – databasschema som körs automatiskt vid varje
  serverstart (säkert eftersom det bara skapar saker som inte redan
  finns).
- `app/public/` – frontend (login, registrering, huvudsidan och
  djurprofilsidan).
