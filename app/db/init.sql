-- Schema för Mina djur. Körs automatiskt av Postgres-containern vid första start
-- (mountas till /docker-entrypoint-initdb.d).

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS users (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	username CITEXT NOT NULL UNIQUE,
	password_hash TEXT NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS animals (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	name TEXT NOT NULL,
	type TEXT NOT NULL,
	birthday DATE,
	info TEXT,
	initial_weight NUMERIC(6,2),
	created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Extra profilfält, tillagda i efterhand (säkert att köra om vid varje start).
ALTER TABLE animals ADD COLUMN IF NOT EXISTS allergies TEXT;
ALTER TABLE animals ADD COLUMN IF NOT EXISTS microchip_id TEXT;
ALTER TABLE animals ADD COLUMN IF NOT EXISTS vet_name TEXT;
ALTER TABLE animals ADD COLUMN IF NOT EXISTS vet_phone TEXT;
ALTER TABLE animals ADD COLUMN IF NOT EXISTS insurance_company TEXT;
ALTER TABLE animals ADD COLUMN IF NOT EXISTS insurance_number TEXT;
ALTER TABLE animals ADD COLUMN IF NOT EXISTS food_type TEXT;
ALTER TABLE animals ADD COLUMN IF NOT EXISTS food_amount TEXT;
ALTER TABLE animals ADD COLUMN IF NOT EXISTS food_frequency TEXT;
ALTER TABLE animals ADD COLUMN IF NOT EXISTS sex TEXT CHECK (sex IN ('Hona', 'Hane', 'Okänt'));
ALTER TABLE animals ADD COLUMN IF NOT EXISTS neutered BOOLEAN;
ALTER TABLE animals ADD COLUMN IF NOT EXISTS breeder TEXT;
ALTER TABLE animals ADD COLUMN IF NOT EXISTS father_name TEXT;
ALTER TABLE animals ADD COLUMN IF NOT EXISTS father_color_pattern TEXT;
ALTER TABLE animals ADD COLUMN IF NOT EXISTS father_coat TEXT;
ALTER TABLE animals ADD COLUMN IF NOT EXISTS mother_name TEXT;
ALTER TABLE animals ADD COLUMN IF NOT EXISTS mother_color_pattern TEXT;
ALTER TABLE animals ADD COLUMN IF NOT EXISTS mother_coat TEXT;

CREATE INDEX IF NOT EXISTS animals_user_id_idx ON animals(user_id);

CREATE TABLE IF NOT EXISTS animal_records (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	animal_id UUID NOT NULL REFERENCES animals(id) ON DELETE CASCADE,
	type TEXT NOT NULL,
	record_date DATE NOT NULL,
	weight NUMERIC(6,2),
	note TEXT,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS animal_records_animal_id_idx ON animal_records(animal_id);

CREATE TABLE IF NOT EXISTS animal_photos (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	animal_id UUID NOT NULL REFERENCES animals(id) ON DELETE CASCADE,
	filename TEXT NOT NULL,
	mime_type TEXT NOT NULL,
	created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS animal_photos_animal_id_idx ON animal_photos(animal_id);

-- Egna påminnelseintervall (i dagar) per djur och typ, t.ex. Kloklippning var 30:e
-- dag. Saknas en rad används ett standardintervall (se ANIMALS_REMINDER_DEFAULTS
-- i routes/animals.js).
CREATE TABLE IF NOT EXISTS animal_reminders (
	id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
	animal_id UUID NOT NULL REFERENCES animals(id) ON DELETE CASCADE,
	type TEXT NOT NULL,
	interval_days INTEGER NOT NULL CHECK (interval_days > 0 AND interval_days <= 3650),
	UNIQUE (animal_id, type)
);

CREATE INDEX IF NOT EXISTS animal_reminders_animal_id_idx ON animal_reminders(animal_id);

-- Session-tabell som krävs av connect-pg-simple
CREATE TABLE IF NOT EXISTS "session" (
	"sid" VARCHAR NOT NULL COLLATE "default" PRIMARY KEY,
	"sess" JSON NOT NULL,
	"expire" TIMESTAMP(6) NOT NULL
);

CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
