CREATE TABLE IF NOT EXISTS healthcare_facilities (
  id BIGSERIAL PRIMARY KEY,
  county_fips CHAR(5) NOT NULL CHECK (county_fips ~ '^[0-9]{5}$'),
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  category TEXT NOT NULL DEFAULT 'other',
  address TEXT,
  phone TEXT,
  website TEXT,
  latitude DOUBLE PRECISION CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION CHECK (longitude BETWEEN -180 AND 180)
);
CREATE INDEX IF NOT EXISTS healthcare_facilities_county_category_idx ON healthcare_facilities (county_fips, category);
