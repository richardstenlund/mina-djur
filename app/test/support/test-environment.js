'use strict';

// Startar en fristående testmiljö: en PGlite-databas (Postgres-protokoll via
// socket) plus själva appservern (server.js) som en separat process som
// pratar med den databasen. Detta gör att de riktiga HTTP-anropen i
// testsviten går mot en riktig (men in-memory) Postgres-kompatibel databas,
// utan att kräva Docker eller en riktig Postgres-installation i CI/lokalt.

const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { PGlite } = require('@electric-sql/pglite');
const { pgcrypto } = require('@electric-sql/pglite/contrib/pgcrypto');
const { citext } = require('@electric-sql/pglite/contrib/citext');
const { PGLiteSocketServer } = require('@electric-sql/pglite-socket');

const APP_ROOT = path.join(__dirname, '..', '..');
const UPLOADS_DIR = path.join(APP_ROOT, 'uploads');

async function getFreePort() {
	const net = require('net');
	return new Promise((resolve, reject) => {
		const server = net.createServer();
		server.unref();
		server.on('error', reject);
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address();
			server.close(() => resolve(port));
		});
	});
}

async function startTestEnvironment() {
	const pgPort = await getFreePort();
	const appPort = await getFreePort();

	const db = await PGlite.create({ extensions: { pgcrypto, citext } });
	const socketServer = new PGLiteSocketServer({ db, port: pgPort, host: '127.0.0.1', maxConnections: 20 });
	await socketServer.start();

	const env = {
		...process.env,
		PGHOST: '127.0.0.1',
		PGPORT: String(pgPort),
		PGUSER: 'postgres',
		PGPASSWORD: 'postgres',
		PGDATABASE: 'postgres',
		SESSION_SECRET: 'test-hemlighet-som-ar-lang-nog-för-tester',
		COOKIE_SECURE: 'false',
		PORT: String(appPort)
	};

	const serverPath = path.join(APP_ROOT, 'server.js');
	const child = spawn(process.execPath, [serverPath], { env, stdio: ['ignore', 'pipe', 'pipe'] });

	let startupOutput = '';
	const ready = new Promise((resolve, reject) => {
		const onData = chunk => {
			startupOutput += chunk.toString();
			if (startupOutput.includes('körs på port')) {
				child.stdout.off('data', onData);
				resolve();
			}
		};
		child.stdout.on('data', onData);
		child.stderr.on('data', chunk => { startupOutput += chunk.toString(); });
		child.on('exit', code => {
			if (code !== 0 && code !== null) reject(new Error(`Testservern avslutades oväntat (kod ${code}):\n${startupOutput}`));
		});
		setTimeout(() => reject(new Error(`Testservern startade inte i tid:\n${startupOutput}`)), 20000);
	});

	await ready;
	child.stderr.on('data', chunk => process.stderr.write(`[testserver] ${chunk}`));

	const baseUrl = `http://127.0.0.1:${appPort}`;

	async function stop() {
		child.kill();
		await new Promise(resolve => child.on('exit', resolve));
		await socketServer.stop();
		await db.close();
		fs.rmSync(UPLOADS_DIR, { recursive: true, force: true });
	}

	return { baseUrl, stop };
}

module.exports = { startTestEnvironment };
