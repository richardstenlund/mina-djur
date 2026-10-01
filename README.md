# Mina djur

Webbapp för att hålla koll på katter och smådjur: vikt, kloklippning,
veterinärbesök, medicin, vaccinationer, avmaskning, pälsvård och egna
anteckningar. Flera personer kan skapa varsitt konto – varje användare
ser bara sina egna djur. Varje djur har en egen profilsida där du kan
ladda upp bilder och uppdatera informationen.

## Snabb installation på en Docker-server

Du behöver en server med Git, Docker Engine och Docker Compose v2 installerat.
Kör följande kommandon i serverns terminal:

```bash
git clone https://github.com/richardstenlund/mina-djur.git
cd mina-djur
cp .env.example .env
```

Skapa två olika, starka hemligheter med `openssl rand -hex 32` (kör kommandot
två gånger). Öppna sedan inställningsfilen:

```bash
nano .env
```

Ersätt `POSTGRES_PASSWORD` och `SESSION_SECRET` med de hemligheter du nyss
skapade. Behåll inte mallens exempelvärden. Spara i nano med `Ctrl+O`, Enter
och avsluta med `Ctrl+X`. Låt `APP_PORT=4300` stå kvar, eller ändra till en
ledig port om 4300 redan används.

Bygg och starta appen:

```bash
docker compose up -d --build
```

Öppna sedan `http://SERVERNS-IP:4300` (eller porten du valde) och skapa ditt
konto via registreringssidan. Om sidan inte öppnas, kontrollera att porten är
ledig och tillåten i serverns brandvägg:

```bash
docker compose ps
docker compose logs --tail=100 app
```

Vid uppdatering efter en ny version räcker det att köra:

```bash
cd mina-djur
git pull
docker compose up -d --build
```

Databasen och uppladdade bilder sparas i Docker-volymerna `db_data` och
`uploads_data`, även när appen byggs om. Ta inte bort volymerna om du vill
behålla dina data.

> **Säkerhet:** För åtkomst utanför hemnätverket, använd en HTTPS-reverse proxy
> (t.ex. Caddy, Nginx eller Traefik) och sätt `COOKIE_SECURE=true` i `.env`.
> Öppna inte tjänsten mot internet via okrypterad HTTP. För lokal HTTP-åtkomst
> ska `COOKIE_SECURE=false` stå kvar.

### Exempelbilder

Här är några av illustrationerna som visas i appen innan du laddar upp egna
foton:

| Katt | Hund | Kanin | Fågel | Sköldpadda |
|---|---|---|---|---|
| ![Illustration av en katt](app/public/images/examples/cat.svg) | ![Illustration av en hund](app/public/images/examples/dog.svg) | ![Illustration av en kanin](app/public/images/examples/rabbit.svg) | ![Illustration av en fågel](app/public/images/examples/bird.svg) | ![Illustration av en sköldpadda](app/public/images/examples/turtle.svg) |

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
- uppdatera namn, djurart, födelsedatum, kön, kastreringsstatus, startvikt
  och övrig information,
- välja eller skriva in ras/variant; förslagen anpassas efter vald djurart,
- spara uppfödare samt namn, färg/teckning och hårlag för far och mor,
- fylla i allergier/specialbehov, chipnummer, veterinärklinik med
  telefonnummer, försäkringsbolag och försäkringsnummer,
- ange foderschema (typ, mängd och hur ofta),
- lägga till och ta bort skötselanteckningar precis som på startsidan,
- se en graf över viktutvecklingen över tid,
- exportera hela skötselhistoriken som en CSV-fil (öppningsbar i Excel).

Den första uppladdade bilden visas som "omslagsbild" på djurets kort på
startsidan. Innan du laddar upp en egen bild visas en lokal exempelillustration
för djurarten. Originalillustrationerna ligger i
[`app/public/images/examples`](./app/public/images/examples) och laddas från
projektet utan externa bildtjänster.

Djurartslistan innehåller bland annat hund, gerbil, chinchilla, degu,
iller, igelkott, sköldpadda, ödla, orm och fisk. Välj "Annat" om du har
en djurart som inte finns med i listan.
Rasförslag visas för varje listad djurart, och egna raser/varianter kan
skrivas in fritt.

## Påminnelser

Varje djur får automatiska påminnelser för kloklippning (standard var
30:e dag), vaccination (standard var 365:e dag) och avmaskning (standard
var 90:e dag), baserat på den senast loggade anteckningen av respektive
typ. Är ett datum nära eller passerat visas en varningsbricka både på
djurets profilsida och som liten badge på djurkortet på startsidan. Du
kan ändra intervallet per djur och påminnelsetyp direkt på profilsidan.

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
