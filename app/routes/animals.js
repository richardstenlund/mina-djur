const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { pool } = require('../db/pool');

const router = express.Router();

const RECORD_TYPES = ['Vikt', 'Kloklippning', 'Veterinärbesök', 'Medicin', 'Vaccination', 'Avmaskning', 'Pälsvård', 'Övrigt'];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8 MB
const ALLOWED_PHOTO_TYPES = {
	'image/jpeg': '.jpg',
	'image/png': '.png',
	'image/webp': '.webp',
	'image/gif': '.gif'
};

// Typer som kan få en påminnelse om "nästa gång", med standardintervall i dagar
// om användaren inte satt ett eget.
const REMINDER_DEFAULTS = {
	Kloklippning: 30,
	Vaccination: 365,
	Avmaskning: 90
};
const REMINDER_TYPES = Object.keys(REMINDER_DEFAULTS);
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function isValidIntervalDays(value) {
	return Number.isInteger(value) && value > 0 && value <= 3650;
}

// Räknar ut status för en påminnelse utifrån senaste anteckningen av den typen
// och vald (eller standard-) intervall. Returnerar null om det aldrig loggats.
function buildReminder(type, latestDate, intervalDays) {
	const interval = intervalDays || REMINDER_DEFAULTS[type];
	if (!latestDate) {
		return { type, intervalDays: interval, lastDate: null, nextDate: null, daysUntil: null, status: 'saknas' };
	}
	const last = new Date(`${latestDate}T00:00:00Z`);
	const next = new Date(last.getTime() + interval * MS_PER_DAY);
	const todayUtc = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
	const daysUntil = Math.round((next.getTime() - todayUtc.getTime()) / MS_PER_DAY);
	let status = 'ok';
	if (daysUntil < 0) status = 'försenad';
	else if (daysUntil <= 7) status = 'snart';
	return {
		type,
		intervalDays: interval,
		lastDate: latestDate,
		nextDate: next.toISOString().slice(0, 10),
		daysUntil,
		status
	};
}

// Bygger påminnelser för ett djur utifrån dess anteckningar och ev. egna intervall.
function buildReminders(records, reminderRows) {
	const intervalByType = new Map(reminderRows.map(row => [row.type, row.interval_days]));
	return REMINDER_TYPES.map(type => {
		const latest = records
			.filter(record => record.type === type)
			.sort((a, b) => b.date.localeCompare(a.date))[0];
		return buildReminder(type, latest ? latest.date : null, intervalByType.get(type));
	});
}

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

const SEX_VALUES = ['Hona', 'Hane', 'Okänt'];

// Validerar och normaliserar fälten för ett djur. Används av både
// "skapa djur" och "uppdatera djur" så reglerna alltid stämmer överens.
function parseAnimalInput(body) {
	const {
		name, type, birthday, info, initialWeight,
		allergies, microchipId, vetName, vetPhone,
		insuranceCompany, insuranceNumber,
		foodType, foodAmount, foodFrequency,
		sex, neutered
	} = body || {};

	if (typeof name !== 'string' || !name.trim() || name.length > 60) {
		return { error: 'Ange ett namn (max 60 tecken).' };
	}
	if (typeof type !== 'string' || !type.trim() || type.length > 40) {
		return { error: 'Ange en djurart.' };
	}
	if (birthday && !isValidDate(birthday)) {
		return { error: 'Ogiltigt födelsedatum.' };
	}
	if (info !== undefined && (typeof info !== 'string' || info.length > 1000)) {
		return { error: 'Informationen är för lång (max 1000 tecken).' };
	}
	let weightValue = null;
	if (initialWeight !== undefined && initialWeight !== null && initialWeight !== '') {
		weightValue = Number(initialWeight);
		if (!isValidWeight(weightValue)) {
			return { error: 'Ange en giltig vikt i kg (0–1000).' };
		}
	}
	let sexValue = null;
	if (sex !== undefined && sex !== null && sex !== '') {
		if (!SEX_VALUES.includes(sex)) {
			return { error: 'Ogiltigt kön.' };
		}
		sexValue = sex;
	}
	const neuteredValue = neutered === true || neutered === 'true';

	const shortTextFields = {
		allergies: [allergies, 500, 'Allergier/specialbehov är för långt (max 500 tecken).'],
		microchipId: [microchipId, 40, 'Chipnumret är för långt (max 40 tecken).'],
		vetName: [vetName, 100, 'Veterinärklinikens namn är för långt (max 100 tecken).'],
		vetPhone: [vetPhone, 40, 'Telefonnumret är för långt (max 40 tecken).'],
		insuranceCompany: [insuranceCompany, 100, 'Försäkringsbolagets namn är för långt (max 100 tecken).'],
		insuranceNumber: [insuranceNumber, 60, 'Försäkringsnumret är för långt (max 60 tecken).'],
		foodType: [foodType, 200, 'Fodertypen är för lång (max 200 tecken).'],
		foodAmount: [foodAmount, 100, 'Fodermängden är för lång (max 100 tecken).'],
		foodFrequency: [foodFrequency, 100, 'Utfodringsfrekvensen är för lång (max 100 tecken).']
	};
	const parsedShortText = {};
	for (const [key, [value, maxLength, errorMessage]] of Object.entries(shortTextFields)) {
		if (value !== undefined && value !== null && typeof value !== 'string') {
			return { error: errorMessage };
		}
		if (typeof value === 'string' && value.length > maxLength) {
			return { error: errorMessage };
		}
		parsedShortText[key] = (value || '').trim();
	}

	return {
		value: {
			name: name.trim(),
			type: type.trim(),
			birthday: birthday || null,
			info: (info || '').trim(),
			initialWeight: weightValue,
			sex: sexValue,
			neutered: neuteredValue,
			...parsedShortText
		}
	};
}


const photoStorage = multer.diskStorage({
	destination: async (req, file, cb) => {
		try {
			const dir = path.join(UPLOADS_DIR, req.params.animalId);
			await fs.promises.mkdir(dir, { recursive: true });
			cb(null, dir);
		} catch (error) {
			cb(error);
		}
	},
	filename: (req, file, cb) => {
		const extension = ALLOWED_PHOTO_TYPES[file.mimetype] || '';
		cb(null, `${crypto.randomUUID()}${extension}`);
	}
});

const uploadPhoto = multer({
	storage: photoStorage,
	limits: { fileSize: MAX_PHOTO_BYTES, files: 1 },
	fileFilter: (req, file, cb) => {
		if (!ALLOWED_PHOTO_TYPES[file.mimetype]) {
			return cb(new Error('OTILLATEN_FILTYP'));
		}
		cb(null, true);
	}
});

router.use(requireAuth);

// Hämta alla djur (med deras historik) för inloggad användare.
router.get('/', async (req, res) => {
	try {
		const animalsResult = await pool.query(
			`SELECT ${ANIMAL_COLUMNS} FROM animals WHERE user_id = $1 ORDER BY created_at DESC`,
			[req.session.userId]
		);
		const animalIds = animalsResult.rows.map(row => row.id);
		let recordsByAnimal = new Map();
		let coverPhotoByAnimal = new Map();
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

			const photosResult = await pool.query(
				`SELECT DISTINCT ON (animal_id) id, animal_id
				 FROM animal_photos WHERE animal_id = ANY($1::uuid[])
				 ORDER BY animal_id, created_at ASC`,
				[animalIds]
			);
			coverPhotoByAnimal = new Map(photosResult.rows.map(row => [row.animal_id, row.id]));
		}

		let remindersByAnimal = new Map();
		if (animalIds.length) {
			const remindersResult = await pool.query(
				'SELECT animal_id, type, interval_days FROM animal_reminders WHERE animal_id = ANY($1::uuid[])',
				[animalIds]
			);
			remindersByAnimal = remindersResult.rows.reduce((map, row) => {
				const list = map.get(row.animal_id) || [];
				list.push(row);
				map.set(row.animal_id, list);
				return map;
			}, new Map());
		}

		const animals = animalsResult.rows.map(row => ({
			...formatAnimal(row),
			records: recordsByAnimal.get(row.id) || [],
			coverPhotoUrl: coverPhotoByAnimal.has(row.id)
				? `/api/animals/${row.id}/photos/${coverPhotoByAnimal.get(row.id)}/file`
				: null,
			reminders: buildReminders(recordsByAnimal.get(row.id) || [], remindersByAnimal.get(row.id) || [])
		}));
		res.json(animals);
	} catch (error) {
		console.error('Fel vid hämtning av djur:', error);
		res.status(500).json({ error: 'Kunde inte hämta djuren just nu.' });
	}
});

const ANIMAL_COLUMNS = `id, name, type, birthday, info, initial_weight,
	allergies, microchip_id, vet_name, vet_phone,
	insurance_company, insurance_number,
	food_type, food_amount, food_frequency,
	sex, neutered`;

// Formaterar en databasrad från "animals" till det JSON-format som frontend använder.
function formatAnimal(row) {
	return {
		id: row.id,
		name: row.name,
		type: row.type,
		birthday: row.birthday ? row.birthday.toISOString().slice(0, 10) : '',
		info: row.info || '',
		initialWeight: row.initial_weight !== null ? Number(row.initial_weight) : null,
		allergies: row.allergies || '',
		microchipId: row.microchip_id || '',
		vetName: row.vet_name || '',
		vetPhone: row.vet_phone || '',
		insuranceCompany: row.insurance_company || '',
		insuranceNumber: row.insurance_number || '',
		foodType: row.food_type || '',
		foodAmount: row.food_amount || '',
		foodFrequency: row.food_frequency || '',
		sex: row.sex || '',
		neutered: row.neutered === true
	};
}

// Lägg till ett nytt djur.
router.post('/', async (req, res) => {
	const parsed = parseAnimalInput(req.body);
	if (parsed.error) {
		return res.status(400).json({ error: parsed.error });
	}
	const { name, type, birthday, info, initialWeight, allergies, microchipId, vetName, vetPhone, insuranceCompany, insuranceNumber, foodType, foodAmount, foodFrequency, sex, neutered } = parsed.value;

	try {
		const result = await pool.query(
			`INSERT INTO animals (user_id, name, type, birthday, info, initial_weight,
				allergies, microchip_id, vet_name, vet_phone, insurance_company, insurance_number,
				food_type, food_amount, food_frequency, sex, neutered)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
			 RETURNING ${ANIMAL_COLUMNS}`,
			[req.session.userId, name, type, birthday, info, initialWeight,
				allergies, microchipId, vetName, vetPhone, insuranceCompany, insuranceNumber,
				foodType, foodAmount, foodFrequency, sex, neutered]
		);
		res.status(201).json({ ...formatAnimal(result.rows[0]), records: [], photos: [], coverPhotoUrl: null, reminders: buildReminders([], []) });
	} catch (error) {
		console.error('Fel vid skapande av djur:', error);
		res.status(500).json({ error: 'Kunde inte spara djuret just nu.' });
	}
});

async function assertOwnedAnimal(animalId, userId) {
	const result = await pool.query('SELECT id FROM animals WHERE id = $1 AND user_id = $2', [animalId, userId]);
	return result.rows.length > 0;
}

// Hämta ett enskilt djur (profil) med historik, foton och påminnelser.
router.get('/:animalId', async (req, res) => {
	try {
		const animalResult = await pool.query(
			`SELECT ${ANIMAL_COLUMNS} FROM animals WHERE id = $1 AND user_id = $2`,
			[req.params.animalId, req.session.userId]
		);
		const row = animalResult.rows[0];
		if (!row) {
			return res.status(404).json({ error: 'Djuret hittades inte.' });
		}

		const [recordsResult, photosResult, remindersResult] = await Promise.all([
			pool.query(
				`SELECT id, type, record_date, weight, note FROM animal_records
				 WHERE animal_id = $1 ORDER BY record_date DESC, created_at DESC`,
				[row.id]
			),
			pool.query(
				'SELECT id, created_at FROM animal_photos WHERE animal_id = $1 ORDER BY created_at ASC',
				[row.id]
			),
			pool.query(
				'SELECT type, interval_days FROM animal_reminders WHERE animal_id = $1',
				[row.id]
			)
		]);

		const records = recordsResult.rows.map(record => ({
			id: record.id,
			type: record.type,
			date: record.record_date.toISOString().slice(0, 10),
			weight: record.weight !== null ? Number(record.weight) : null,
			note: record.note || ''
		}));

		res.json({
			...formatAnimal(row),
			records,
			photos: photosResult.rows.map(photo => ({
				id: photo.id,
				url: `/api/animals/${row.id}/photos/${photo.id}/file`
			})),
			reminders: buildReminders(records, remindersResult.rows)
		});
	} catch (error) {
		console.error('Fel vid hämtning av djurprofil:', error);
		res.status(500).json({ error: 'Kunde inte hämta djuret just nu.' });
	}
});

// Uppdatera ett djurs profilinformation.
router.put('/:animalId', async (req, res) => {
	const parsed = parseAnimalInput(req.body);
	if (parsed.error) {
		return res.status(400).json({ error: parsed.error });
	}
	const { name, type, birthday, info, initialWeight, allergies, microchipId, vetName, vetPhone, insuranceCompany, insuranceNumber, foodType, foodAmount, foodFrequency, sex, neutered } = parsed.value;

	try {
		const result = await pool.query(
			`UPDATE animals SET name = $1, type = $2, birthday = $3, info = $4, initial_weight = $5,
				allergies = $6, microchip_id = $7, vet_name = $8, vet_phone = $9,
				insurance_company = $10, insurance_number = $11,
				food_type = $12, food_amount = $13, food_frequency = $14,
				sex = $15, neutered = $16
			 WHERE id = $17 AND user_id = $18
			 RETURNING ${ANIMAL_COLUMNS}`,
			[name, type, birthday, info, initialWeight,
				allergies, microchipId, vetName, vetPhone, insuranceCompany, insuranceNumber,
				foodType, foodAmount, foodFrequency, sex, neutered,
				req.params.animalId, req.session.userId]
		);
		const row = result.rows[0];
		if (!row) {
			return res.status(404).json({ error: 'Djuret hittades inte.' });
		}
		res.json(formatAnimal(row));
	} catch (error) {
		console.error('Fel vid uppdatering av djur:', error);
		res.status(500).json({ error: 'Kunde inte uppdatera djuret just nu.' });
	}
});

// Sätt ett eget påminnelseintervall (i dagar) för en viss typ, eller ta bort det
// (och återgå till standardvärdet) genom att skicka intervalDays = null.
router.put('/:animalId/reminders/:type', async (req, res) => {
	const { type } = req.params;
	const { intervalDays } = req.body || {};
	if (!REMINDER_TYPES.includes(type)) {
		return res.status(400).json({ error: 'Ogiltig påminnelsetyp.' });
	}
	try {
		const owned = await assertOwnedAnimal(req.params.animalId, req.session.userId);
		if (!owned) {
			return res.status(404).json({ error: 'Djuret hittades inte.' });
		}
		if (intervalDays === null || intervalDays === undefined || intervalDays === '') {
			await pool.query('DELETE FROM animal_reminders WHERE animal_id = $1 AND type = $2', [req.params.animalId, type]);
			return res.json({ type, intervalDays: REMINDER_DEFAULTS[type] });
		}
		const days = Number(intervalDays);
		if (!isValidIntervalDays(days)) {
			return res.status(400).json({ error: 'Ange ett intervall i dagar (1–3650).' });
		}
		await pool.query(
			`INSERT INTO animal_reminders (animal_id, type, interval_days) VALUES ($1, $2, $3)
			 ON CONFLICT (animal_id, type) DO UPDATE SET interval_days = EXCLUDED.interval_days`,
			[req.params.animalId, type, days]
		);
		res.json({ type, intervalDays: days });
	} catch (error) {
		console.error('Fel vid uppdatering av påminnelse:', error);
		res.status(500).json({ error: 'Kunde inte spara påminnelsen just nu.' });
	}
});

// Exportera historiken som CSV, t.ex. för att ta med till veterinären.
router.get('/:animalId/export.csv', async (req, res) => {
	try {
		const animalResult = await pool.query(
			'SELECT name FROM animals WHERE id = $1 AND user_id = $2',
			[req.params.animalId, req.session.userId]
		);
		const animal = animalResult.rows[0];
		if (!animal) {
			return res.status(404).json({ error: 'Djuret hittades inte.' });
		}
		const recordsResult = await pool.query(
			`SELECT type, record_date, weight, note FROM animal_records
			 WHERE animal_id = $1 ORDER BY record_date ASC, created_at ASC`,
			[req.params.animalId]
		);
		const escapeCsv = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
		const lines = [['Datum', 'Typ', 'Vikt (kg)', 'Anteckning'].map(escapeCsv).join(';')];
		recordsResult.rows.forEach(record => {
			lines.push([
				record.record_date.toISOString().slice(0, 10),
				record.type,
				record.weight !== null ? Number(record.weight) : '',
				record.note || ''
			].map(escapeCsv).join(';'));
		});
		const csv = `\uFEFF${lines.join('\r\n')}`;
		const safeName = animal.name.replace(/[^a-zA-Z0-9åäöÅÄÖ_-]+/g, '_');
		res.setHeader('Content-Type', 'text/csv; charset=utf-8');
		res.setHeader('Content-Disposition', `attachment; filename="${safeName || 'djur'}-historik.csv"`);
		res.send(csv);
	} catch (error) {
		console.error('Fel vid export av historik:', error);
		res.status(500).json({ error: 'Kunde inte exportera historiken just nu.' });
	}
});


// Ta bort ett djur (och dess historik/foton via ON DELETE CASCADE).
router.delete('/:animalId', async (req, res) => {
	try {
		const result = await pool.query(
			'DELETE FROM animals WHERE id = $1 AND user_id = $2 RETURNING id',
			[req.params.animalId, req.session.userId]
		);
		if (!result.rows.length) {
			return res.status(404).json({ error: 'Djuret hittades inte.' });
		}
		await fs.promises.rm(path.join(UPLOADS_DIR, req.params.animalId), { recursive: true, force: true });
		res.status(204).end();
	} catch (error) {
		console.error('Fel vid borttagning av djur:', error);
		res.status(500).json({ error: 'Kunde inte ta bort djuret just nu.' });
	}
});

// Ladda upp ett foto till ett djurs profil.
router.post('/:animalId/photos', async (req, res, next) => {
	const owned = await assertOwnedAnimal(req.params.animalId, req.session.userId);
	if (!owned) {
		return res.status(404).json({ error: 'Djuret hittades inte.' });
	}
	next();
}, (req, res) => {
	uploadPhoto.single('photo')(req, res, async (error) => {
		if (error) {
			if (error.message === 'OTILLATEN_FILTYP') {
				return res.status(400).json({ error: 'Endast JPEG, PNG, WEBP eller GIF är tillåtet.' });
			}
			if (error.code === 'LIMIT_FILE_SIZE') {
				return res.status(400).json({ error: 'Bilden är för stor (max 8 MB).' });
			}
			console.error('Fel vid uppladdning av foto:', error);
			return res.status(500).json({ error: 'Kunde inte ladda upp bilden just nu.' });
		}
		if (!req.file) {
			return res.status(400).json({ error: 'Ingen bild bifogades.' });
		}
		try {
			const result = await pool.query(
				`INSERT INTO animal_photos (animal_id, filename, mime_type)
				 VALUES ($1, $2, $3) RETURNING id`,
				[req.params.animalId, req.file.filename, req.file.mimetype]
			);
			const photoId = result.rows[0].id;
			res.status(201).json({ id: photoId, url: `/api/animals/${req.params.animalId}/photos/${photoId}/file` });
		} catch (dbError) {
			console.error('Fel vid sparande av foto i databasen:', dbError);
			await fs.promises.unlink(path.join(UPLOADS_DIR, req.params.animalId, req.file.filename)).catch(() => {});
			res.status(500).json({ error: 'Kunde inte spara bilden just nu.' });
		}
	});
});

// Hämta själva bildfilen (kräver inloggning + ägarskap, serveras inte som statisk fil).
router.get('/:animalId/photos/:photoId/file', async (req, res) => {
	try {
		const owned = await assertOwnedAnimal(req.params.animalId, req.session.userId);
		if (!owned) {
			return res.status(404).end();
		}
		const result = await pool.query(
			'SELECT filename, mime_type FROM animal_photos WHERE id = $1 AND animal_id = $2',
			[req.params.photoId, req.params.animalId]
		);
		const photo = result.rows[0];
		if (!photo) {
			return res.status(404).end();
		}
		const filePath = path.join(UPLOADS_DIR, req.params.animalId, photo.filename);
		res.type(photo.mime_type);
		res.sendFile(filePath, (error) => {
			if (error && !res.headersSent) {
				res.status(404).end();
			}
		});
	} catch (error) {
		console.error('Fel vid hämtning av foto:', error);
		res.status(500).end();
	}
});

// Ta bort ett foto.
router.delete('/:animalId/photos/:photoId', async (req, res) => {
	try {
		const owned = await assertOwnedAnimal(req.params.animalId, req.session.userId);
		if (!owned) {
			return res.status(404).json({ error: 'Djuret hittades inte.' });
		}
		const result = await pool.query(
			'DELETE FROM animal_photos WHERE id = $1 AND animal_id = $2 RETURNING filename',
			[req.params.photoId, req.params.animalId]
		);
		const photo = result.rows[0];
		if (!photo) {
			return res.status(404).json({ error: 'Bilden hittades inte.' });
		}
		await fs.promises.unlink(path.join(UPLOADS_DIR, req.params.animalId, photo.filename)).catch(() => {});
		res.status(204).end();
	} catch (error) {
		console.error('Fel vid borttagning av foto:', error);
		res.status(500).json({ error: 'Kunde inte ta bort bilden just nu.' });
	}
});

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
