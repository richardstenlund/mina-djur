const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
	throw new Error('DATABASE_URL saknas. Sätt miljövariabeln innan servern startar.');
}

const pool = new Pool({
	connectionString: process.env.DATABASE_URL
});

pool.on('error', err => {
	// Bakgrundsfel på inaktiva klienter i poolen ska inte krascha processen.
	console.error('Oväntat fel från Postgres-poolen:', err);
});

async function waitForDatabase(retries = 20, delayMs = 1500) {
	for (let attempt = 1; attempt <= retries; attempt += 1) {
		try {
			await pool.query('SELECT 1');
			return;
		} catch (error) {
			console.log(`Väntar på databasen (försök ${attempt}/${retries})...`);
			await new Promise(resolve => setTimeout(resolve, delayMs));
		}
	}
	throw new Error('Kunde inte ansluta till databasen efter flera försök.');
}

module.exports = { pool, waitForDatabase };
