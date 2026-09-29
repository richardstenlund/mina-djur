const express = require('express');
const { pool } = require('../db/pool');

const router = express.Router();

const RECORD_TYPES = ['Vikt', 'Kloklippning', 'Veterinärbesök', 'Medicin', 'Vaccination', 'Pälsvård', 'Övrigt'];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function requireAuth(req, res, next) {
	if (!req.session.userId) {
		return res.status(401).json({ error: 'Inte inloggad.' });
	}
	next();
}

function isValidWeight(value) {
	return Number.isFinite(value) && value > 0 && value <= 1000;
}

function isValidDate(value) {
	return typeof value === 'string' && DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(value));
}

router.use(requireAuth);

// Hämta alla djur (med deras historik) för inloggad användare.
router.get('/', async (req, res) => {
	try {
		const animalsResult = await pool.query(
			`SELECT id, name, type, birthday, info, initial_weight
			 FROM animals WHERE user_id = $1 ORDER BY created_at DESC`,
			[req.session.userId]
		);
		const animalIds = animalsResult.rows.map(row => row.id);
		let recordsByAnimal = new Map();
		if (animalIds.length) {
			const recordsResult = await pool.query(
				`SELECT id, animal_id, type, record_date, weight, note
				 FROM animal_records WHERE animal_id = ANY($1::uuid[]) ORDER BY record_date DESC, created_at DESC`,
				[animalIds]
			);
			recordsByAnimal = recordsResult.rows.reduce((map, record) => {
				const list = map.get(record.animal_id) || [];
				list.push({
					id: record.id,
					type: record.type,
					date: record.record_date.toISOString().slice(0, 10),
					weight: record.weight !== null ? Number(record.weight) : null,
					note: record.note || ''
				});
				map.set(record.animal_id, list);
				return map;
			}, new Map());
		}

		const animals = animalsResult.rows.map(row => ({
			id: row.id,
			name: row.name,
			type: row.type,
			birthday: row.birthday ? row.birthday.toISOString().slice(0, 10) : '',
			info: row.info || '',
			initialWeight: row.initial_weight !== null ? Number(row.initial_weight) : null,
			records: recordsByAnimal.get(row.id) || []
		}));
		res.json(animals);
	} catch (error) {
		console.error('Fel vid hämtning av djur:', error);
		res.status(500).json({ error: 'Kunde inte hämta djuren just nu.' });
	}
});

// Lägg till ett nytt djur.
router.post('/', async (req, res) => {
	const { name, type, birthday, info, initialWeight } = req.body || {};

	if (typeof name !== 'string' || !name.trim() || name.length > 60) {
		return res.status(400).json({ error: 'Ange ett namn (max 60 tecken).' });
	}
	if (typeof type !== 'string' || !type.trim() || type.length > 40) {
		return res.status(400).json({ error: 'Ange en djurart.' });
	}
	if (birthday && !isValidDate(birthday)) {
		return res.status(400).json({ error: 'Ogiltigt födelsedatum.' });
	}
	if (info !== undefined && (typeof info !== 'string' || info.length > 1000)) {
		return res.status(400).json({ error: 'Informationen är för lång (max 1000 tecken).' });
	}
	let weightValue = null;
	if (initialWeight !== undefined && initialWeight !== null && initialWeight !== '') {
		weightValue = Number(initialWeight);
		if (!isValidWeight(weightValue)) {
			return res.status(400).json({ error: 'Ange en giltig vikt i kg (0–1000).' });
		}
	}

	try {
		const result = await pool.query(
			`INSERT INTO animals (user_id, name, type, birthday, info, initial_weight)
			 VALUES ($1, $2, $3, $4, $5, $6)
			 RETURNING id, name, type, birthday, info, initial_weight`,
			[req.session.userId, name.trim(), type.trim(), birthday || null, (info || '').trim(), weightValue]
		);
		const row = result.rows[0];
		res.status(201).json({
			id: row.id,
			name: row.name,
			type: row.type,
			birthday: row.birthday ? row.birthday.toISOString().slice(0, 10) : '',
			info: row.info || '',
			initialWeight: row.initial_weight !== null ? Number(row.initial_weight) : null,
			records: []
		});
	} catch (error) {
		console.error('Fel vid skapande av djur:', error);
		res.status(500).json({ error: 'Kunde inte spara djuret just nu.' });
	}
});

// Ta bort ett djur (och dess historik via ON DELETE CASCADE).
router.delete('/:animalId', async (req, res) => {
	try {
		const result = await pool.query(
			'DELETE FROM animals WHERE id = $1 AND user_id = $2 RETURNING id',
			[req.params.animalId, req.session.userId]
		);
		if (!result.rows.length) {
			return res.status(404).json({ error: 'Djuret hittades inte.' });
		}
		res.status(204).end();
	} catch (error) {
		console.error('Fel vid borttagning av djur:', error);
		res.status(500).json({ error: 'Kunde inte ta bort djuret just nu.' });
	}
});

async function assertOwnedAnimal(animalId, userId) {
	const result = await pool.query('SELECT id FROM animals WHERE id = $1 AND user_id = $2', [animalId, userId]);
	return result.rows.length > 0;
}

// Lägg till en anteckning (vikt, kloklippning, veterinärbesök, etc.) för ett djur.
router.post('/:animalId/records', async (req, res) => {
	const { type, date, weight, note } = req.body || {};

	if (!RECORD_TYPES.includes(type)) {
		return res.status(400).json({ error: 'Ogiltig typ av anteckning.' });
	}
	if (!isValidDate(date)) {
		return res.status(400).json({ error: 'Ange ett giltigt datum.' });
	}
	let weightValue = null;
	if (type === 'Vikt') {
		weightValue = Number(weight);
		if (!isValidWeight(weightValue)) {
			return res.status(400).json({ error: 'Ange en giltig vikt i kg (0–1000).' });
		}
	}
	if (note !== undefined && (typeof note !== 'string' || note.length > 500)) {
		return res.status(400).json({ error: 'Anteckningen är för lång (max 500 tecken).' });
	}

	try {
		const owned = await assertOwnedAnimal(req.params.animalId, req.session.userId);
		if (!owned) {
			return res.status(404).json({ error: 'Djuret hittades inte.' });
		}
		const result = await pool.query(
			`INSERT INTO animal_records (animal_id, type, record_date, weight, note)
			 VALUES ($1, $2, $3, $4, $5)
			 RETURNING id, type, record_date, weight, note`,
			[req.params.animalId, type, date, weightValue, (note || '').trim()]
		);
		const row = result.rows[0];
		res.status(201).json({
			id: row.id,
			type: row.type,
			date: row.record_date.toISOString().slice(0, 10),
			weight: row.weight !== null ? Number(row.weight) : null,
			note: row.note || ''
		});
	} catch (error) {
		console.error('Fel vid skapande av anteckning:', error);
		res.status(500).json({ error: 'Kunde inte spara anteckningen just nu.' });
	}
});

// Ta bort en anteckning.
router.delete('/:animalId/records/:recordId', async (req, res) => {
	try {
		const owned = await assertOwnedAnimal(req.params.animalId, req.session.userId);
		if (!owned) {
			return res.status(404).json({ error: 'Djuret hittades inte.' });
		}
		const result = await pool.query(
			'DELETE FROM animal_records WHERE id = $1 AND animal_id = $2 RETURNING id',
			[req.params.recordId, req.params.animalId]
		);
		if (!result.rows.length) {
			return res.status(404).json({ error: 'Anteckningen hittades inte.' });
		}
		res.status(204).end();
	} catch (error) {
		console.error('Fel vid borttagning av anteckning:', error);
		res.status(500).json({ error: 'Kunde inte ta bort anteckningen just nu.' });
	}
});

module.exports = router;
