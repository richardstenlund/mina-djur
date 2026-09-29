const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');

const required = ['PGHOST', 'PGUSER', 'PGPASSWORD', 'PGDATABASE'];
const missing = required.filter(key => !process.env[key]);
if (missing.length) {
	throw new Error(`Följande miljövariabler saknas för databasanslutningen: ${missing.join(', ')}`);
}

// Separata PG*-variabler (istället för en sammansatt DATABASE_URL-sträng) läses
// automatiskt av node-postgres och slipper problem med specialtecken i lösenord
// som annars måste URL-kodas manuellt (t.ex. @ : / # ? %).
const pool = new Pool({
	host: process.env.PGHOST,
	port: Number(process.env.PGPORT) || 5432,
	user: process.env.PGUSER,
	password: process.env.PGPASSWORD,
	database: process.env.PGDATABASE
});

pool.on('error', err => {
	// Bakgrundsfel på inaktiva klienter i poolen ska inte krascha processen.
	console.error('Oväntat fel från Postgres-poolen:', err);
});

async function waitForDatabase(retries = 20, delayMs = 1500) {
	let lastError;
	for (let attempt = 1; attempt <= retries; attempt += 1) {
		try {
			await pool.query('SELECT 1');
			return;
		} catch (error) {
			lastError = error;
			console.log(`Väntar på databasen (försök ${attempt}/${retries})... Fel: ${error.message}`);
			await new Promise(resolve => setTimeout(resolve, delayMs));
		}
	}
	throw new Error(`Kunde inte ansluta till databasen efter flera försök. Senaste fel: ${lastError?.message}`);
}

async function runMigrations() {
	// init.sql använder bara CREATE ... IF NOT EXISTS, så det är säkert att
	// köra vid varje serverstart. Det gör att befintliga installationer får
	// nya tabeller/kolumner automatiskt utan att någon manuellt måste
	// nollställa databasen vid en uppdatering.
	const sql = fs.readFileSync(path.join(__dirname, 'init.sql'), 'utf8');
	await pool.query(sql);
}

module.exports = { pool, waitForDatabase, runMigrations };
