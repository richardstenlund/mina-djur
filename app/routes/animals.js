const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { pool } = require('../db/pool');

const router = express.Router();

// Begränsar delningsförsök (POST /shares) per IP, för att hindra att någon
// "gissar" sig fram till giltiga användarnamn genom upprepade anrop.
const shareLimiter = rateLimit({
	windowMs: 15 * 60 * 1000,
	max: 30,
	standardHeaders: true,
	legacyHeaders: false,
	message: { error: 'För många delningsförsök. Vänta en stund och försök igen.' }
});

const RECORD_TYPES = ['Vikt', 'Kloklippning', 'Veterinärbesök', 'Medicin', 'Vaccination', 'Avmaskning', 'Pälsvård', 'Hälsodagbok', 'Övrigt'];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const DOCUMENTS_DIR = UPLOADS_DIR;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024; // 8 MB
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const ALLOWED_PHOTO_TYPES = {
	'image/jpeg': '.jpg',
	'image/png': '.png',
	'image/webp': '.webp',
	'image/gif': '.gif'
};
const ALLOWED_DOCUMENT_TYPES = {
	'application/pdf': '.pdf',
	'image/jpeg': '.jpg',
	'image/png': '.png',
	'image/webp': '.webp'
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
	return typeof value === 'string' && DATE_PATTERN.test(value)
		&& !Number.isNaN(Date.parse(value))
		&& new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}

// Formaterar ett DATE-värde från databasen till "YYYY-MM-DD".
// node-postgres parsar DATE-kolumner till ett Date-objekt satt till lokal
// midnatt. Att då använda toISOString() (som konverterar till UTC) kan
// skifta datumet en dag om processen körs i en tidszon öster om UTC
// (t.ex. Europe/Stockholm). Vi läser därför ut de lokala komponenterna
// istället för att gå via UTC.
function formatDateOnly(date) {
	if (!date) return '';
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
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
		sex, neutered, breeder, fatherName, fatherColorPattern, fatherCoat,
		motherName, motherColorPattern, motherCoat, breed
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
		foodFrequency: [foodFrequency, 100, 'Utfodringsfrekvensen är för lång (max 100 tecken).'],
		breeder: [breeder, 100, 'Uppfödarens namn är för långt (max 100 tecken).'],
		fatherName: [fatherName, 100, 'Faderns namn är för långt (max 100 tecken).'],
		fatherColorPattern: [fatherColorPattern, 100, 'Faderns färg och teckning är för långt (max 100 tecken).'],
		fatherCoat: [fatherCoat, 100, 'Faderns hårlag är för långt (max 100 tecken).'],
		motherName: [motherName, 100, 'Moderns namn är för långt (max 100 tecken).'],
		motherColorPattern: [motherColorPattern, 100, 'Moderns färg och teckning är för långt (max 100 tecken).'],
		motherCoat: [motherCoat, 100, 'Moderns hårlag är för långt (max 100 tecken).'],
		breed: [breed, 100, 'Rasen/varianten är för lång (max 100 tecken).']
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

const documentStorage = multer.diskStorage({
	destination: async (req, file, cb) => {
		try {
			const dir = path.join(DOCUMENTS_DIR, req.params.animalId, 'documents');
			await fs.promises.mkdir(dir, { recursive: true });
			cb(null, dir);
		} catch (error) {
			cb(error);
		}
	},
	filename: (req, file, cb) => {
		const extension = ALLOWED_DOCUMENT_TYPES[file.mimetype] || '';
		cb(null, `${crypto.randomUUID()}${extension}`);
	}
});

const uploadDocument = multer({
	storage: documentStorage,
	limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1 },
	fileFilter: (req, file, cb) => {
		if (!ALLOWED_DOCUMENT_TYPES[file.mimetype]) {
			return cb(new Error('OTILLATEN_DOKUMENTTYP'));
		}
		cb(null, true);
	}
});

router.use(requireAuth);

// Hämta egna djur och djur som andra användare har delat med kontot.
router.get('/', async (req, res) => {
	try {
		const animalColumns = ANIMAL_COLUMNS.split(',').map(column => `a.${column.trim()}`).join(', ');
		const animalsResult = await pool.query(
			`SELECT ${animalColumns},
				a.user_id = $1 AS is_owner
			 FROM animals a
			 WHERE a.user_id = $1 OR EXISTS (
				SELECT 1 FROM animal_shares s WHERE s.animal_id = a.id AND s.user_id = $1
			 )
			 ORDER BY a.created_at DESC`,
			[req.session.userId]
		);
		const animalIds = animalsResult.rows.map(row => row.id);
		let recordsByAnimal = new Map();
		let coverPhotoByAnimal = new Map();
		if (animalIds.length) {
			const recordsResult = await pool.query(
				`SELECT id, animal_id, type, record_date, weight, note, diagnosis, treatment,
					follow_up_date, symptoms, appetite, mood
				 FROM animal_records WHERE animal_id = ANY($1::uuid[]) ORDER BY record_date DESC, created_at DESC`,
				[animalIds]
			);
			recordsByAnimal = recordsResult.rows.reduce((map, record) => {
				const list = map.get(record.animal_id) || [];
				list.push({
					id: record.id,
					type: record.type,
					date: formatDateOnly(record.record_date),
					weight: record.weight !== null ? Number(record.weight) : null,
					note: record.note || '',
					diagnosis: record.diagnosis || '',
					treatment: record.treatment || '',
					followUpDate: formatDateOnly(record.follow_up_date),
					symptoms: record.symptoms || '',
					appetite: record.appetite || '',
					mood: record.mood || ''
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
			isOwner: row.is_owner,
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
	sex, neutered, breeder, father_name, father_color_pattern, father_coat,
	mother_name, mother_color_pattern, mother_coat, breed`;

// Formaterar en databasrad från "animals" till det JSON-format som frontend använder.
function formatAnimal(row) {
	return {
		id: row.id,
		name: row.name,
		type: row.type,
		birthday: formatDateOnly(row.birthday),
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
		neutered: row.neutered === true,
		breeder: row.breeder || '',
		fatherName: row.father_name || '',
		fatherColorPattern: row.father_color_pattern || '',
		fatherCoat: row.father_coat || '',
		motherName: row.mother_name || '',
		motherColorPattern: row.mother_color_pattern || '',
		motherCoat: row.mother_coat || '',
		breed: row.breed || ''
	};
}

// Lägg till ett nytt djur.
router.post('/', async (req, res) => {
	const parsed = parseAnimalInput(req.body);
	if (parsed.error) {
		return res.status(400).json({ error: parsed.error });
	}
	const { name, type, birthday, info, initialWeight, allergies, microchipId, vetName, vetPhone, insuranceCompany, insuranceNumber, foodType, foodAmount, foodFrequency, sex, neutered, breeder, fatherName, fatherColorPattern, fatherCoat, motherName, motherColorPattern, motherCoat, breed } = parsed.value;

	try {
		const result = await pool.query(
			`INSERT INTO animals (user_id, name, type, birthday, info, initial_weight,
				allergies, microchip_id, vet_name, vet_phone, insurance_company, insurance_number,
				food_type, food_amount, food_frequency, sex, neutered,
				breeder, father_name, father_color_pattern, father_coat,
				mother_name, mother_color_pattern, mother_coat, breed)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
				$18, $19, $20, $21, $22, $23, $24, $25)
			 RETURNING ${ANIMAL_COLUMNS}`,
			[req.session.userId, name, type, birthday, info, initialWeight,
				allergies, microchipId, vetName, vetPhone, insuranceCompany, insuranceNumber,
				foodType, foodAmount, foodFrequency, sex, neutered, breeder, fatherName,
				fatherColorPattern, fatherCoat, motherName, motherColorPattern, motherCoat, breed]
		);
		res.status(201).json({ ...formatAnimal(result.rows[0]), isOwner: true, records: [], photos: [], coverPhotoUrl: null, reminders: buildReminders([], []) });
	} catch (error) {
		console.error('Fel vid skapande av djur:', error);
		res.status(500).json({ error: 'Kunde inte spara djuret just nu.' });
	}
});

async function hasAnimalAccess(animalId, userId) {
	return Boolean(await canAccessAnimal(animalId, userId));
}

async function isAnimalOwner(animalId, userId) {
	const result = await pool.query('SELECT id FROM animals WHERE id = $1 AND user_id = $2', [animalId, userId]);
	return result.rows.length > 0;
}

async function canAccessAnimal(animalId, userId) {
	const result = await pool.query(
		`SELECT a.id, a.user_id, (a.user_id = $2) AS is_owner
		 FROM animals a
		 LEFT JOIN animal_shares s ON s.animal_id = a.id AND s.user_id = $2
		 WHERE a.id = $1 AND (a.user_id = $2 OR s.user_id = $2)`,
		[animalId, userId]
	);
	return result.rows[0] || null;
}

// Hämta ett enskilt djur (profil) med historik, foton och påminnelser.
router.get('/:animalId', async (req, res) => {
	try {
		const animalResult = await pool.query(
			`SELECT ${ANIMAL_COLUMNS.split(',').map(column => `a.${column.trim()}`).join(', ')},
				a.user_id = $2 AS is_owner
			 FROM animals a
			 WHERE a.id = $1 AND (a.user_id = $2 OR EXISTS (
				SELECT 1 FROM animal_shares s WHERE s.animal_id = a.id AND s.user_id = $2
			 ))`,
			[req.params.animalId, req.session.userId]
		);
		const row = animalResult.rows[0];
		if (!row) {
			return res.status(404).json({ error: 'Djuret hittades inte.' });
		}

		const [recordsResult, photosResult, remindersResult, medicationsResult, costsResult, documentsResult, sharesResult] = await Promise.all([
			pool.query(
				`SELECT id, type, record_date, weight, note, diagnosis, treatment,
					follow_up_date, symptoms, appetite, mood FROM animal_records
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
			),
			pool.query(
				`SELECT id, name, dosage, frequency, start_date, end_date, next_dose, note
				 FROM animal_medications WHERE animal_id = $1 ORDER BY next_dose NULLS LAST, start_date DESC`,
				[row.id]
			),
			pool.query(
				`SELECT id, cost_date, category, amount, note FROM animal_costs
				 WHERE animal_id = $1 ORDER BY cost_date DESC, created_at DESC`,
				[row.id]
			),
			pool.query(
				`SELECT id, display_name, created_at FROM animal_documents
				 WHERE animal_id = $1 ORDER BY created_at DESC`,
				[row.id]
			),
			pool.query(
				`SELECT s.id, u.username FROM animal_shares s
				 JOIN users u ON u.id = s.user_id
				 WHERE s.animal_id = $1 AND $2 = (SELECT user_id FROM animals WHERE id = $1)
				 ORDER BY u.username`,
				[row.id, req.session.userId]
			)
		]);

		const records = recordsResult.rows.map(record => ({
			id: record.id,
			type: record.type,
			date: formatDateOnly(record.record_date),
			weight: record.weight !== null ? Number(record.weight) : null,
			note: record.note || '',
			diagnosis: record.diagnosis || '',
			treatment: record.treatment || '',
			followUpDate: formatDateOnly(record.follow_up_date),
			symptoms: record.symptoms || '',
			appetite: record.appetite || '',
			mood: record.mood || ''
		}));

		res.json({
			...formatAnimal(row),
			isOwner: row.is_owner,
			records,
			photos: photosResult.rows.map(photo => ({
				id: photo.id,
				url: `/api/animals/${row.id}/photos/${photo.id}/file`
			})),
			reminders: buildReminders(records, remindersResult.rows),
			medications: medicationsResult.rows.map(item => ({
				id: item.id, name: item.name, dosage: item.dosage, frequency: item.frequency,
				startDate: formatDateOnly(item.start_date),
				endDate: formatDateOnly(item.end_date),
				nextDose: formatDateOnly(item.next_dose),
				note: item.note || ''
			})),
			costs: costsResult.rows.map(item => ({
				id: item.id, date: formatDateOnly(item.cost_date),
				category: item.category, amount: Number(item.amount), note: item.note || ''
			})),
			documents: documentsResult.rows.map(item => ({
				id: item.id, name: item.display_name, uploadedAt: item.created_at,
				url: `/api/animals/${row.id}/documents/${item.id}/file`
			})),
			shares: sharesResult.rows.map(item => ({ id: item.id, username: item.username }))
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
	const { name, type, birthday, info, initialWeight, allergies, microchipId, vetName, vetPhone, insuranceCompany, insuranceNumber, foodType, foodAmount, foodFrequency, sex, neutered, breeder, fatherName, fatherColorPattern, fatherCoat, motherName, motherColorPattern, motherCoat, breed } = parsed.value;

	try {
		const result = await pool.query(
			`UPDATE animals SET name = $1, type = $2, birthday = $3, info = $4, initial_weight = $5,
				allergies = $6, microchip_id = $7, vet_name = $8, vet_phone = $9,
				insurance_company = $10, insurance_number = $11,
				food_type = $12, food_amount = $13, food_frequency = $14,
				sex = $15, neutered = $16,
				breeder = $17, father_name = $18, father_color_pattern = $19, father_coat = $20,
				mother_name = $21, mother_color_pattern = $22, mother_coat = $23,
				breed = $24
			 WHERE id = $25 AND (user_id = $26 OR EXISTS (
				SELECT 1 FROM animal_shares s WHERE s.animal_id = animals.id AND s.user_id = $26
			 ))
			 RETURNING ${ANIMAL_COLUMNS}`,
			[name, type, birthday, info, initialWeight,
				allergies, microchipId, vetName, vetPhone, insuranceCompany, insuranceNumber,
				foodType, foodAmount, foodFrequency, sex, neutered, breeder, fatherName,
				fatherColorPattern, fatherCoat, motherName, motherColorPattern, motherCoat, breed,
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
		const accessible = await hasAnimalAccess(req.params.animalId, req.session.userId);
		if (!accessible) {
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

router.post('/:animalId/medications', async (req, res) => {
	const { name, dosage, frequency, startDate, endDate, nextDose, note } = req.body || {};
	const fields = { name: [name, 120], dosage: [dosage, 120], frequency: [frequency, 120] };
	for (const [field, [value, maxLength]] of Object.entries(fields)) {
		if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
			return res.status(400).json({ error: `Ange ${field} (max ${maxLength} tecken).` });
		}
	}
	if (!isValidDate(startDate) || (endDate && !isValidDate(endDate)) || (nextDose && !isValidDate(nextDose))) {
		return res.status(400).json({ error: 'Ange giltiga datum för medicineringen.' });
	}
	if (endDate && endDate < startDate) {
		return res.status(400).json({ error: 'Slutdatum kan inte vara före startdatum.' });
	}
	if (note !== undefined && (typeof note !== 'string' || note.length > 500)) {
		return res.status(400).json({ error: 'Anteckningen är för lång (max 500 tecken).' });
	}
	try {
		if (!await hasAnimalAccess(req.params.animalId, req.session.userId)) {
			return res.status(404).json({ error: 'Djuret hittades inte.' });
		}
		const result = await pool.query(
			`INSERT INTO animal_medications (animal_id, name, dosage, frequency, start_date, end_date, next_dose, note)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
			 RETURNING id, name, dosage, frequency, start_date, end_date, next_dose, note`,
			[req.params.animalId, name.trim(), dosage.trim(), frequency.trim(), startDate,
				endDate || null, nextDose || null, (note || '').trim()]
		);
		const medication = result.rows[0];
		res.status(201).json({
			id: medication.id, name: medication.name, dosage: medication.dosage,
			frequency: medication.frequency, startDate: formatDateOnly(medication.start_date),
			endDate: formatDateOnly(medication.end_date),
			nextDose: formatDateOnly(medication.next_dose),
			note: medication.note || ''
		});
	} catch (error) {
		console.error('Fel vid sparande av medicin:', error);
		res.status(500).json({ error: 'Kunde inte spara medicinen just nu.' });
	}
});

router.put('/:animalId/medications/:medicationId', async (req, res) => {
	const { name, dosage, frequency, startDate, endDate, nextDose, note } = req.body || {};
	if ([name, dosage, frequency].some(value => typeof value !== 'string' || !value.trim() || value.length > 120)) {
		return res.status(400).json({ error: 'Ange namn, dosering och frekvens (max 120 tecken vardera).' });
	}
	if (!isValidDate(startDate) || (endDate && !isValidDate(endDate)) || (nextDose && !isValidDate(nextDose))) {
		return res.status(400).json({ error: 'Ange giltiga datum för medicineringen.' });
	}
	if (endDate && endDate < startDate) {
		return res.status(400).json({ error: 'Slutdatum kan inte vara före startdatum.' });
	}
	if (note !== undefined && (typeof note !== 'string' || note.length > 500)) {
		return res.status(400).json({ error: 'Anteckningen är för lång (max 500 tecken).' });
	}
	try {
		if (!await hasAnimalAccess(req.params.animalId, req.session.userId)) {
			return res.status(404).json({ error: 'Djuret hittades inte.' });
		}
		const result = await pool.query(
			`UPDATE animal_medications SET name = $1, dosage = $2, frequency = $3,
				start_date = $4, end_date = $5, next_dose = $6, note = $7
			 WHERE id = $8 AND animal_id = $9
			 RETURNING id, name, dosage, frequency, start_date, end_date, next_dose, note`,
			[name.trim(), dosage.trim(), frequency.trim(), startDate, endDate || null,
				nextDose || null, (note || '').trim(), req.params.medicationId, req.params.animalId]
		);
		const medication = result.rows[0];
		if (!medication) return res.status(404).json({ error: 'Medicinen hittades inte.' });
		res.json({
			id: medication.id, name: medication.name, dosage: medication.dosage,
			frequency: medication.frequency, startDate: formatDateOnly(medication.start_date),
			endDate: formatDateOnly(medication.end_date),
			nextDose: formatDateOnly(medication.next_dose),
			note: medication.note || ''
		});
	} catch (error) {
		console.error('Fel vid uppdatering av medicin:', error);
		res.status(500).json({ error: 'Kunde inte uppdatera medicinen just nu.' });
	}
});

router.delete('/:animalId/medications/:medicationId', async (req, res) => {
	try {
		if (!await hasAnimalAccess(req.params.animalId, req.session.userId)) {
			return res.status(404).json({ error: 'Djuret hittades inte.' });
		}
		const result = await pool.query(
			'DELETE FROM animal_medications WHERE id = $1 AND animal_id = $2 RETURNING id',
			[req.params.medicationId, req.params.animalId]
		);
		if (!result.rows.length) return res.status(404).json({ error: 'Medicinen hittades inte.' });
		res.status(204).end();
	} catch (error) {
		console.error('Fel vid borttagning av medicin:', error);
		res.status(500).json({ error: 'Kunde inte ta bort medicinen just nu.' });
	}
});

router.post('/:animalId/costs', async (req, res) => {
	const { date, category, amount, note } = req.body || {};
	const amountValue = Number(amount);
	if (!isValidDate(date)) return res.status(400).json({ error: 'Ange ett giltigt datum.' });
	if (typeof category !== 'string' || !category.trim() || category.length > 60) {
		return res.status(400).json({ error: 'Ange en kostnadstyp (max 60 tecken).' });
	}
	if (!Number.isFinite(amountValue) || amountValue <= 0 || amountValue > 99999999.99) {
		return res.status(400).json({ error: 'Ange ett belopp större än 0 kr.' });
	}
	if (note !== undefined && (typeof note !== 'string' || note.length > 500)) {
		return res.status(400).json({ error: 'Anteckningen är för lång (max 500 tecken).' });
	}
	try {
		if (!await hasAnimalAccess(req.params.animalId, req.session.userId)) {
			return res.status(404).json({ error: 'Djuret hittades inte.' });
		}
		const result = await pool.query(
			`INSERT INTO animal_costs (animal_id, cost_date, category, amount, note)
			 VALUES ($1, $2, $3, $4, $5) RETURNING id, cost_date, category, amount, note`,
			[req.params.animalId, date, category.trim(), amountValue, (note || '').trim()]
		);
		const cost = result.rows[0];
		res.status(201).json({
			id: cost.id, date: formatDateOnly(cost.cost_date),
			category: cost.category, amount: Number(cost.amount), note: cost.note || ''
		});
	} catch (error) {
		console.error('Fel vid sparande av kostnad:', error);
		res.status(500).json({ error: 'Kunde inte spara kostnaden just nu.' });
	}
});

router.delete('/:animalId/costs/:costId', async (req, res) => {
	try {
		if (!await hasAnimalAccess(req.params.animalId, req.session.userId)) {
			return res.status(404).json({ error: 'Djuret hittades inte.' });
		}
		const result = await pool.query(
			'DELETE FROM animal_costs WHERE id = $1 AND animal_id = $2 RETURNING id',
			[req.params.costId, req.params.animalId]
		);
		if (!result.rows.length) return res.status(404).json({ error: 'Kostnaden hittades inte.' });
		res.status(204).end();
	} catch (error) {
		console.error('Fel vid borttagning av kostnad:', error);
		res.status(500).json({ error: 'Kunde inte ta bort kostnaden just nu.' });
	}
});

router.post('/:animalId/documents', async (req, res, next) => {
	try {
		if (!await hasAnimalAccess(req.params.animalId, req.session.userId)) {
			return res.status(404).json({ error: 'Djuret hittades inte.' });
		}
		next();
	} catch (error) {
		console.error('Fel vid kontroll av dokumentåtkomst:', error);
		res.status(500).json({ error: 'Kunde inte kontrollera åtkomsten just nu.' });
	}
}, (req, res) => {
	uploadDocument.single('document')(req, res, async error => {
		if (error) {
			if (error.message === 'OTILLATEN_DOKUMENTTYP') {
				return res.status(400).json({ error: 'Tillåtna dokument är PDF, JPEG, PNG och WEBP.' });
			}
			if (error.code === 'LIMIT_FILE_SIZE') {
				return res.status(400).json({ error: 'Dokumentet är för stort (max 10 MB).' });
			}
			console.error('Fel vid uppladdning av dokument:', error);
			return res.status(500).json({ error: 'Kunde inte ladda upp dokumentet just nu.' });
		}
		if (!req.file) return res.status(400).json({ error: 'Välj ett dokument att ladda upp.' });
		const displayName = path.basename(req.file.originalname).replace(/[\\/\r\n"]/g, '_').slice(0, 180) || 'Dokument';
		try {
			const result = await pool.query(
				`INSERT INTO animal_documents (animal_id, filename, display_name, mime_type)
				 VALUES ($1, $2, $3, $4) RETURNING id, display_name, created_at`,
				[req.params.animalId, req.file.filename, displayName, req.file.mimetype]
			);
			const document = result.rows[0];
			res.status(201).json({
				id: document.id, name: document.display_name, uploadedAt: document.created_at,
				url: `/api/animals/${req.params.animalId}/documents/${document.id}/file`
			});
		} catch (dbError) {
			console.error('Fel vid sparande av dokument i databasen:', dbError);
			try {
				await fs.promises.unlink(path.join(DOCUMENTS_DIR, req.params.animalId, 'documents', req.file.filename));
			} catch (cleanupError) {
				console.error('Kunde inte rensa uppladdat dokument efter databasfel:', cleanupError);
			}
			res.status(500).json({ error: 'Kunde inte spara dokumentet just nu.' });
		}
	});
});

router.get('/:animalId/documents/:documentId/file', async (req, res) => {
	try {
		if (!await hasAnimalAccess(req.params.animalId, req.session.userId)) return res.status(404).end();
		const result = await pool.query(
			'SELECT filename, display_name FROM animal_documents WHERE id = $1 AND animal_id = $2',
			[req.params.documentId, req.params.animalId]
		);
		const document = result.rows[0];
		if (!document) return res.status(404).end();
		res.setHeader('X-Content-Type-Options', 'nosniff');
		res.download(path.join(DOCUMENTS_DIR, req.params.animalId, 'documents', document.filename), document.display_name, error => {
			if (error && !res.headersSent) res.status(404).end();
		});
	} catch (error) {
		console.error('Fel vid hämtning av dokument:', error);
		if (!res.headersSent) res.status(500).end();
	}
});

router.delete('/:animalId/documents/:documentId', async (req, res) => {
	try {
		if (!await hasAnimalAccess(req.params.animalId, req.session.userId)) {
			return res.status(404).json({ error: 'Djuret hittades inte.' });
		}
		const result = await pool.query(
			'DELETE FROM animal_documents WHERE id = $1 AND animal_id = $2 RETURNING filename',
			[req.params.documentId, req.params.animalId]
		);
		const document = result.rows[0];
		if (!document) return res.status(404).json({ error: 'Dokumentet hittades inte.' });
		await fs.promises.unlink(path.join(DOCUMENTS_DIR, req.params.animalId, 'documents', document.filename));
		res.status(204).end();
	} catch (error) {
		console.error('Fel vid borttagning av dokument:', error);
		res.status(500).json({ error: 'Kunde inte ta bort dokumentet just nu.' });
	}
});

router.get('/:animalId/shares', async (req, res) => {
	try {
		if (!await isAnimalOwner(req.params.animalId, req.session.userId)) {
			return res.status(404).json({ error: 'Djuret hittades inte.' });
		}
		const result = await pool.query(
			`SELECT s.id, u.username FROM animal_shares s
			 JOIN users u ON u.id = s.user_id
			 WHERE s.animal_id = $1 ORDER BY u.username`,
			[req.params.animalId]
		);
		res.json(result.rows);
	} catch (error) {
		console.error('Fel vid hämtning av delade användare:', error);
		res.status(500).json({ error: 'Kunde inte hämta delningen just nu.' });
	}
});

router.post('/:animalId/shares', shareLimiter, async (req, res) => {
	const { username } = req.body || {};
	if (typeof username !== 'string' || !username.trim() || username.trim().length > 32) {
		return res.status(400).json({ error: 'Ange ett giltigt användarnamn.' });
	}
	try {
		if (!await isAnimalOwner(req.params.animalId, req.session.userId)) {
			return res.status(404).json({ error: 'Djuret hittades inte.' });
		}
		const userResult = await pool.query('SELECT id, username FROM users WHERE username = $1', [username.trim()]);
		const targetUser = userResult.rows[0];
		if (!targetUser) return res.status(404).json({ error: 'Användaren hittades inte.' });
		if (targetUser.id === req.session.userId) {
			return res.status(400).json({ error: 'Du kan inte dela djuret med ditt eget konto.' });
		}
		const result = await pool.query(
			`INSERT INTO animal_shares (animal_id, user_id) VALUES ($1, $2)
			 RETURNING id`,
			[req.params.animalId, targetUser.id]
		);
		res.status(201).json({ id: result.rows[0].id, username: targetUser.username });
	} catch (error) {
		if (error.code === '23505') return res.status(409).json({ error: 'Djuret är redan delat med det kontot.' });
		console.error('Fel vid delning av djur:', error);
		res.status(500).json({ error: 'Kunde inte dela djuret just nu.' });
	}
});

router.delete('/:animalId/shares/:shareId', async (req, res) => {
	try {
		if (!await isAnimalOwner(req.params.animalId, req.session.userId)) {
			return res.status(404).json({ error: 'Djuret hittades inte.' });
		}
		const result = await pool.query(
			'DELETE FROM animal_shares WHERE id = $1 AND animal_id = $2 RETURNING id',
			[req.params.shareId, req.params.animalId]
		);
		if (!result.rows.length) return res.status(404).json({ error: 'Delningen hittades inte.' });
		res.status(204).end();
	} catch (error) {
		console.error('Fel vid borttagning av delning:', error);
		res.status(500).json({ error: 'Kunde inte ta bort delningen just nu.' });
	}
});

// Exportera historiken som CSV, t.ex. för att ta med till veterinären.
router.get('/:animalId/export.csv', async (req, res) => {
	try {
		const access = await canAccessAnimal(req.params.animalId, req.session.userId);
		const animalResult = access
			? await pool.query('SELECT name FROM animals WHERE id = $1', [req.params.animalId])
			: { rows: [] };
		const animal = animalResult.rows[0];
		if (!animal) {
			return res.status(404).json({ error: 'Djuret hittades inte.' });
		}
		const recordsResult = await pool.query(
			`SELECT type, record_date, weight, note, diagnosis, treatment, follow_up_date,
				symptoms, appetite, mood FROM animal_records
			 WHERE animal_id = $1 ORDER BY record_date ASC, created_at ASC`,
			[req.params.animalId]
		);
		const escapeCsv = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
		const lines = [['Datum', 'Typ', 'Vikt (kg)', 'Anteckning', 'Diagnos', 'Behandling', 'Uppföljning', 'Symtom', 'Aptit', 'Humör'].map(escapeCsv).join(';')];
		recordsResult.rows.forEach(record => {
			lines.push([
				formatDateOnly(record.record_date),
				record.type,
				record.weight !== null ? Number(record.weight) : '',
				record.note || '',
				record.diagnosis || '',
				record.treatment || '',
				formatDateOnly(record.follow_up_date),
				record.symptoms || '',
				record.appetite || '',
				record.mood || ''
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
	try {
		const accessible = await hasAnimalAccess(req.params.animalId, req.session.userId);
		if (!accessible) {
			return res.status(404).json({ error: 'Djuret hittades inte.' });
		}
		next();
	} catch (error) {
		console.error('Fel vid kontroll av fotoåtkomst:', error);
		res.status(500).json({ error: 'Kunde inte kontrollera åtkomsten just nu.' });
	}
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
		const accessible = await hasAnimalAccess(req.params.animalId, req.session.userId);
		if (!accessible) {
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
		const accessible = await hasAnimalAccess(req.params.animalId, req.session.userId);
		if (!accessible) {
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
	const { type, date, weight, note, diagnosis, treatment, followUpDate, symptoms, appetite, mood } = req.body || {};

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
	if (followUpDate && !isValidDate(followUpDate)) {
		return res.status(400).json({ error: 'Ogiltigt uppföljningsdatum.' });
	}
	if (followUpDate && followUpDate < date) {
		return res.status(400).json({ error: 'Uppföljningsdatum kan inte vara före anteckningsdatumet.' });
	}
	const recordTextFields = { diagnosis: 300, treatment: 1000, symptoms: 1000, appetite: 100, mood: 100 };
	for (const [field, maxLength] of Object.entries(recordTextFields)) {
		if (req.body[field] !== undefined && (typeof req.body[field] !== 'string' || req.body[field].length > maxLength)) {
			return res.status(400).json({ error: `Fältet ${field} är för långt (max ${maxLength} tecken).` });
		}
	}

	try {
		const accessible = await hasAnimalAccess(req.params.animalId, req.session.userId);
		if (!accessible) {
			return res.status(404).json({ error: 'Djuret hittades inte.' });
		}
		const result = await pool.query(
			`INSERT INTO animal_records
				(animal_id, type, record_date, weight, note, diagnosis, treatment, follow_up_date, symptoms, appetite, mood)
			 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
			 RETURNING id, type, record_date, weight, note, diagnosis, treatment, follow_up_date, symptoms, appetite, mood`,
			[req.params.animalId, type, date, weightValue, (note || '').trim(),
				(diagnosis || '').trim(), (treatment || '').trim(), followUpDate || null,
				(symptoms || '').trim(), (appetite || '').trim(), (mood || '').trim()]
		);
		const row = result.rows[0];
		res.status(201).json({
			id: row.id,
			type: row.type,
			date: formatDateOnly(row.record_date),
			weight: row.weight !== null ? Number(row.weight) : null,
			note: row.note || '',
			diagnosis: row.diagnosis || '',
			treatment: row.treatment || '',
			followUpDate: formatDateOnly(row.follow_up_date),
			symptoms: row.symptoms || '',
			appetite: row.appetite || '',
			mood: row.mood || ''
		});
	} catch (error) {
		console.error('Fel vid skapande av anteckning:', error);
		res.status(500).json({ error: 'Kunde inte spara anteckningen just nu.' });
	}
});

// Ta bort en anteckning.
router.delete('/:animalId/records/:recordId', async (req, res) => {
	try {
		const accessible = await hasAnimalAccess(req.params.animalId, req.session.userId);
		if (!accessible) {
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
