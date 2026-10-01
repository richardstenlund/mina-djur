const express = require('express');
const { pool } = require('../db/pool');
const { buildReminders, formatAnimal, formatDateOnly } = require('./animals');

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

// Hämta ett specifikt kontos djur i skrivskyddat läge. Vem som helst som är
// inloggad kan bläddra bland andra användares djur, men djuren markeras med
// isOwner/isShared/canEdit = false här så att profilsidan vet att visa dem
// skrivskyddat – de faktiska skriv-routerna i animals.js kräver fortfarande
// ägarskap eller delad åtkomst.
router.get('/:userId/animals', async (req, res) => {
	try {
		const userResult = await pool.query('SELECT id, username FROM users WHERE id = $1', [req.params.userId]);
		const targetUser = userResult.rows[0];
		if (!targetUser) {
			return res.status(404).json({ error: 'Användaren hittades inte.' });
		}

		const animalColumns = `id, name, type, birthday, info, initial_weight,
			allergies, microchip_id, vet_name, vet_phone,
			insurance_company, insurance_number,
			food_type, food_amount, food_frequency,
			sex, neutered, breeder, father_name, father_color_pattern, father_coat,
			mother_name, mother_color_pattern, mother_coat, breed`;
		const animalsResult = await pool.query(
			`SELECT ${animalColumns.split(',').map(column => column.trim()).join(', ')}
			 FROM animals WHERE user_id = $1 ORDER BY created_at DESC`,
			[targetUser.id]
		);
		const animalIds = animalsResult.rows.map(row => row.id);

		let recordsByAnimal = new Map();
		let coverPhotoByAnimal = new Map();
		let remindersByAnimal = new Map();
		if (animalIds.length) {
			const [recordsResult, photosResult, remindersResult] = await Promise.all([
				pool.query(
					`SELECT id, animal_id, type, record_date, weight, note
					 FROM animal_records WHERE animal_id = ANY($1::uuid[]) ORDER BY record_date DESC, created_at DESC`,
					[animalIds]
				),
				pool.query(
					`SELECT DISTINCT ON (animal_id) id, animal_id
					 FROM animal_photos WHERE animal_id = ANY($1::uuid[])
					 ORDER BY animal_id, created_at ASC`,
					[animalIds]
				),
				pool.query(
					'SELECT animal_id, type, interval_days FROM animal_reminders WHERE animal_id = ANY($1::uuid[])',
					[animalIds]
				)
			]);
			recordsByAnimal = recordsResult.rows.reduce((map, record) => {
				const list = map.get(record.animal_id) || [];
				list.push({
					id: record.id,
					type: record.type,
					date: formatDateOnly(record.record_date),
					weight: record.weight !== null ? Number(record.weight) : null,
					note: record.note || ''
				});
				map.set(record.animal_id, list);
				return map;
			}, new Map());
			coverPhotoByAnimal = new Map(photosResult.rows.map(row => [row.animal_id, row.id]));
			remindersByAnimal = remindersResult.rows.reduce((map, row) => {
				const list = map.get(row.animal_id) || [];
				list.push(row);
				map.set(row.animal_id, list);
				return map;
			}, new Map());
		}

		const animals = animalsResult.rows.map(row => ({
			...formatAnimal(row),
			isOwner: false,
			isShared: false,
			canEdit: false,
			ownerUsername: targetUser.username,
			records: recordsByAnimal.get(row.id) || [],
			coverPhotoUrl: coverPhotoByAnimal.has(row.id)
				? `/api/animals/${row.id}/photos/${coverPhotoByAnimal.get(row.id)}/file`
				: null,
			reminders: buildReminders(recordsByAnimal.get(row.id) || [], remindersByAnimal.get(row.id) || [])
		}));
		res.json({ username: targetUser.username, animals });
	} catch (error) {
		console.error('Fel vid hämtning av användarens djur:', error);
		res.status(500).json({ error: 'Kunde inte hämta djuren just nu.' });
	}
});

module.exports = router;
