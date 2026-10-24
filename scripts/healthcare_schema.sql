-- Schema already installed in the new HEALTHCARE_DIRECTORY Neon project.
-- Apply to a new/fresh Neon database only; no existing records are erased.
CREATE TABLE IF NOT EXISTS public.healthcare_facilities (
 id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 source_name TEXT NOT NULL CHECK (btrim(source_name) <> ''),
 source_record_id TEXT NOT NULL CHECK (btrim(source_record_id) <> ''),
 name TEXT NOT NULL CHECK (btrim(name) <> ''),
 category TEXT NOT NULL CHECK (btrim(category) <> ''),
 county_fips CHAR(5) NOT NULL CHECK (county_fips ~ '^[0-9]{5}$'),
 address TEXT,
 city TEXT,
 state TEXT,
 postal_code TEXT,
 phone TEXT,
 email TEXT,
 website TEXT,
 latitude DOUBLE PRECISION CHECK (latitude BETWEEN -90 AND 90),
 longitude DOUBLE PRECISION CHECK (longitude BETWEEN -180 AND 180),
 source_url TEXT,
 metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE (source_name, source_record_id)
);
CREATE INDEX IF NOT EXISTS healthcare_facilities_county_category_name_idx
 ON public.healthcare_facilities (county_fips,category,name);
CREATE INDEX IF NOT EXISTS healthcare_facilities_name_idx
 ON public.healthcare_facilities (name);
