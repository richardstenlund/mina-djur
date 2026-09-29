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

-- Session-tabell som krävs av connect-pg-simple
CREATE TABLE IF NOT EXISTS "session" (
	"sid" VARCHAR NOT NULL COLLATE "default" PRIMARY KEY,
	"sess" JSON NOT NULL,
	"expire" TIMESTAMP(6) NOT NULL
);

CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
