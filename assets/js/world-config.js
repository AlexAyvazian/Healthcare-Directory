/* International Directory public configuration. Nothing here is a secret:
 * - WORLD_DATA_API_URL is the public Neon Data API endpoint of WORLD_HEALTHCARE_DIRECTORY
 *   (development branch `feature-global-directory`), exposing only the read-only `directory` schema.
 * - WORLD_AUTH_URL is that branch's public Neon Auth endpoint; the viewer only requests the
 *   short-lived *anonymous* token from it (role `anonymous`, SELECT-only on published fields).
 * No PostgreSQL connection string, password, or management key belongs in this file. */
export const WORLD_DATA_API_URL = 'https://ep-old-pine-b5jgsksc.apirest.c-7.us-east-2.aws.neon.tech/neondb/rest/v1';
export const WORLD_AUTH_URL = 'https://ep-old-pine-b5jgsksc.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth';

/* geoBoundaries files copied byte-for-byte into the static site at build time (hash-verified).
 * Every other subdivision file is fetched from the same pinned geoBoundaries commit on demand and
 * verified against the SHA-256 in world-catalog.js before use. */
export const BUNDLED_GEO = [
  ['CAN', 'ADM1'], ['CAN', 'ADM2'],
  ['MEX', 'ADM1'], ['MEX', 'ADM2'],
  ['DEU', 'ADM1'], ['DEU', 'ADM2'], ['DEU', 'ADM3'],
  ['GBR', 'ADM1'], ['GBR', 'ADM2'],
  ['AUS', 'ADM1'], ['AUS', 'ADM2']
];
export const BUNDLED_GEO_ROOT = '/geo/gbOpen';
export const REMOTE_GEO_ROOT = commit => `https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/${commit}/releaseData/gbOpen`;
