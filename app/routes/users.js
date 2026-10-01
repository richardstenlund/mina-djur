const express = require('express');
const { pool } = require('../db/pool');

const router = express.Router();

function requireAuth(req, res, next) {
	if (!req.session.userId) {
		return res.status(401).json({ error: 'Inte inloggad.' });
	}
	next();
}

router.use(requireAuth);

// Lista alla andra användare på sidan. Användarnamn är inte hemliga – de
// behövs för att kunna ange vem man vill dela ett djur med – men ingen
// annan information om kontona (lösenord, djur osv.) visas här. Vi räknar
// även ut hur många djur du delar med varandra, så man ser relationen
// direkt i listan.
router.get('/', async (req, res) => {
	try {
		const result = await pool.query(
			`SELECT u.id, u.username,
				COALESCE(shared_by_me.count, 0)::int AS shared_by_me,
				COALESCE(shared_with_me.count, 0)::int AS shared_with_me
			 FROM users u
			 LEFT JOIN (
				SELECT s.user_id AS target_user_id, COUNT(*) AS count
				FROM animal_shares s
				JOIN animals a ON a.id = s.animal_id
				WHERE a.user_id = $1
				GROUP BY s.user_id
			 ) shared_by_me ON shared_by_me.target_user_id = u.id
			 LEFT JOIN (
				SELECT a.user_id AS owner_user_id, COUNT(*) AS count
				FROM animal_shares s
				JOIN animals a ON a.id = s.animal_id
				WHERE s.user_id = $1
				GROUP BY a.user_id
			 ) shared_with_me ON shared_with_me.owner_user_id = u.id
			 WHERE u.id != $1
			 ORDER BY u.username`,
			[req.session.userId]
		);
		res.json(result.rows.map(row => ({
			id: row.id,
			username: row.username,
			sharedByMe: row.shared_by_me,
			sharedWithMe: row.shared_with_me
		})));
	} catch (error) {
		console.error('Fel vid hämtning av användare:', error);
		res.status(500).json({ error: 'Kunde inte hämta användarna just nu.' });
	}
});

module.exports = router;
