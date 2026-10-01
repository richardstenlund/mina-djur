const path = require('path');
const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const { pool, waitForDatabase, runMigrations } = require('./db/pool');
const authRoutes = require('./routes/auth');
const animalsRoutes = require('./routes/animals');
const usersRoutes = require('./routes/users');

const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET;
// Sätt COOKIE_SECURE=true endast om du kör bakom en HTTPS-reverse proxy.
// Annars skickas aldrig sessionscookien och inloggningen "fungerar" inte.
const cookieSecure = process.env.COOKIE_SECURE === 'true';

if (!SESSION_SECRET) {
	throw new Error('SESSION_SECRET saknas. Sätt en lång, slumpad hemlighet i miljövariabeln.');
}

async function start() {
	await waitForDatabase();
	await runMigrations();

	const app = express();
	app.disable('x-powered-by');
	app.set('trust proxy', 1);

	app.use((req, res, next) => {
		res.setHeader('X-Content-Type-Options', 'nosniff');
		res.setHeader('X-Frame-Options', 'DENY');
		res.setHeader('Referrer-Policy', 'same-origin');
		next();
	});

	app.use(express.json({ limit: '100kb' }));
	app.use(session({
		store: new pgSession({ pool, tableName: 'session' }),
		name: 'minadjur.sid',
		secret: SESSION_SECRET,
		resave: false,
		saveUninitialized: false,
		rolling: true,
		cookie: {
			httpOnly: true,
			sameSite: 'lax',
			secure: cookieSecure,
			maxAge: 1000 * 60 * 60 * 24 * 14
		}
	}));

	app.use('/api/auth', authRoutes);
	app.use('/api/animals', animalsRoutes);
	app.use('/api/users', usersRoutes);

	app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

	app.use(express.static(path.join(__dirname, 'public'), { index: false }));

	// Skydda huvudsidan: kräver inloggning, annars skickas man till login.
	app.get('/', (req, res) => {
		if (!req.session.userId) {
			return res.redirect('/login.html');
		}
		res.sendFile(path.join(__dirname, 'public', 'index.html'));
	});

	app.use((req, res) => {
		res.status(404).json({ error: 'Hittades inte.' });
	});

	app.listen(PORT, () => {
		console.log(`Mina djur körs på port ${PORT}`);
	});
}

start().catch(error => {
	console.error('Servern kunde inte startas:', error);
	process.exit(1);
});
