const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { pool } = require('../db/pool');

const router = express.Router();

const USERNAME_PATTERN = /^[a-zA-Z0-9_.-]{3,32}$/;
const MIN_PASSWORD_LENGTH = 8;

const authLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	max: 20,
	standardHeaders: true,
	legacyHeaders: false,
	message: { error: 'För många försök. Vänta en stund och försök igen.' }
});

function validateCredentials(username, password) {
	if (typeof username !== 'string' || !USERNAME_PATTERN.test(username)) {
		return 'Användarnamn måste vara 3–32 tecken (bokstäver, siffror, . _ -).';
	}
	if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
		return `Lösenordet måste vara minst ${MIN_PASSWORD_LENGTH} tecken.`;
	}
	return null;
}

router.post('/register', authLimiter, async (req, res) => {
	const { username, password } = req.body || {};
	const validationError = validateCredentials(username, password);
	if (validationError) {
		return res.status(400).json({ error: validationError });
	}

	try {
		const passwordHash = await bcrypt.hash(password, 12);
		const result = await pool.query(
			'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username',
			[username, passwordHash]
		);
		const user = result.rows[0];
		req.session.regenerate(regenerateError => {
			if (regenerateError) {
				console.error('Kunde inte skapa session vid registrering:', regenerateError);
				return res.status(500).json({ error: 'Kontot skapades men inloggning misslyckades. Försök logga in.' });
			}
			req.session.userId = user.id;
			req.session.username = user.username;
			res.status(201).json({ id: user.id, username: user.username });
		});
	} catch (error) {
		if (error.code === '23505') {
			return res.status(409).json({ error: 'Användarnamnet är redan taget.' });
		}
		console.error('Fel vid registrering:', error);
		res.status(500).json({ error: 'Kunde inte skapa kontot just nu.' });
	}
});

router.post('/login', authLimiter, async (req, res) => {
	const { username, password } = req.body || {};
	if (typeof username !== 'string' || typeof password !== 'string') {
		return res.status(400).json({ error: 'Ange användarnamn och lösenord.' });
	}

	try {
		const result = await pool.query(
			'SELECT id, username, password_hash FROM users WHERE username = $1',
			[username]
		);
		const user = result.rows[0];
		const passwordMatches = user ? await bcrypt.compare(password, user.password_hash) : false;
		if (!user || !passwordMatches) {
			return res.status(401).json({ error: 'Fel användarnamn eller lösenord.' });
		}
		req.session.regenerate(regenerateError => {
			if (regenerateError) {
				console.error('Kunde inte skapa session vid inloggning:', regenerateError);
				return res.status(500).json({ error: 'Inloggning misslyckades. Försök igen.' });
			}
			req.session.userId = user.id;
			req.session.username = user.username;
			res.json({ id: user.id, username: user.username });
		});
	} catch (error) {
		console.error('Fel vid inloggning:', error);
		res.status(500).json({ error: 'Kunde inte logga in just nu.' });
	}
});

router.post('/logout', (req, res) => {
	req.session.destroy(error => {
		if (error) {
			console.error('Fel vid utloggning:', error);
			return res.status(500).json({ error: 'Kunde inte logga ut.' });
		}
		res.clearCookie('minadjur.sid');
		res.status(204).end();
	});
});

router.get('/me', (req, res) => {
	if (!req.session.userId) {
		return res.status(401).json({ error: 'Inte inloggad.' });
	}
	res.json({ id: req.session.userId, username: req.session.username });
});

module.exports = router;
