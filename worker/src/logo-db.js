import {neon} from '@neondatabase/serverless';
import {ApiError} from './http.js';

export function logoDb(env, directory) {
  const key = directory === 'usa' ? 'HEALTHCARE_DIRECTORY_US_LOGO_DATABASE_URL' : directory === 'international' ? 'HEALTHCARE_DIRECTORY_INTERNATIONAL_LOGO_DATABASE_URL' : null;
  if (!key) throw new ApiError(400, 'invalid_directory', 'Choose usa or international.');
  if (!env[key]) throw new ApiError(503, 'logos_not_configured', 'Logo storage is unavailable.');
  const sql=neon(env[key]);
  return {query:(query,params=[])=>sql.query(query,params,{fetchOptions:{signal:AbortSignal.timeout(15000)}})};
}

export const LOGO_SCHEMA = `
CREATE TABLE IF NOT EXISTS brands (
  brand_key text PRIMARY KEY,
  domain text,
  brand_name text NOT NULL,
  provider text,
  logo_url text,
  image_base64 text,
  image_type text,
  candidate jsonb,
  logo_variant text NOT NULL DEFAULT 'icon',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','resolved','not_found','review','error')),
  locked boolean NOT NULL DEFAULT false,
  manual_override boolean NOT NULL DEFAULT false,
  attempted_at timestamptz,
  resolved_at timestamptz,
  retry_after timestamptz,
  lease_until timestamptz,
  lease_token text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS brands_domain_idx ON brands(domain) WHERE domain IS NOT NULL;
CREATE TABLE IF NOT EXISTS facility_brand_map (
  facility_source text NOT NULL,
  facility_id text NOT NULL,
  facility_name text NOT NULL,
  brand_key text NOT NULL REFERENCES brands(brand_key),
  match_method text NOT NULL,
  match_confidence numeric NOT NULL CHECK (match_confidence BETWEEN 0 AND 1),
  manual_override boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(facility_source, facility_id)
);
CREATE INDEX IF NOT EXISTS facility_brand_key_idx ON facility_brand_map(brand_key);
CREATE TABLE IF NOT EXISTS logo_lookup_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  brand_key text NOT NULL,
  provider text NOT NULL,
  account_name text NOT NULL,
  outcome text NOT NULL,
  http_status integer,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS logo_provider_accounts (
  account_name text PRIMARY KEY,
  fingerprint text NOT NULL,
  unavailable_until timestamptz,
  last_status integer,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS logo_enrichment_state (
  job text PRIMARY KEY,
  cursor_value text,
  stage text NOT NULL DEFAULT 'websites',
  lease_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE facility_brand_map ENABLE ROW LEVEL SECURITY;
ALTER TABLE logo_lookup_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE logo_provider_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE logo_enrichment_state ENABLE ROW LEVEL SECURITY;
`;
