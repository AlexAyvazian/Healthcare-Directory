import {copyFile, mkdir, rm, readFile, writeFile, stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {COUNTRIES, GEOBOUNDARIES_COMMIT} from '../assets/js/world-catalog.js';
import {BUNDLED_GEO, BUNDLED_GEO_ROOT, REMOTE_GEO_ROOT} from '../assets/js/world-config.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = join(root,'dist');
// Explicit allowlist: NEVER publish the Node server, environment files, scripts, or tests.
const files = [
  'index.html',
  'assets/css/healthcare.css',
  'assets/js/healthcare-map.js',
  'assets/js/neon-data.js',
  'assets/vendor/d3.min.js',
  'assets/vendor/topojson-client.min.js',
  'assets/vendor/us-atlas-counties-albers-10m.js',
  'assets/vendor/us-atlas.LICENSE',
  // International Directory
  'world.html',
  'assets/css/world.css',
  'assets/js/world-map.js',
  'assets/js/world-data.js',
  'assets/js/world-geo.js',
  'assets/js/world-colors.js',
  'assets/js/world-labels.js',
  'assets/js/world-catalog.js',
  'assets/js/world-config.js',
  'assets/js/registry-data.js',
  'assets/vendor/world-atlas-countries-50m.json',
  'assets/vendor/world-atlas.LICENSE'
];
await rm(dist, {force:true, recursive:true});
for (const file of files) {
  const destination = join(dist,file);
  await mkdir(dirname(destination),{recursive:true});
  await copyFile(join(root,file),destination);
}

/* Original geoBoundaries files, copied UNCHANGED. Each download is checked against the exact byte
 * count and SHA-256 pinned in world-catalog.js; any mismatch fails the build — there is no fallback
 * geometry. Verified files are cached in .geo-cache/ (gitignored) by digest to avoid re-downloading. */
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const cacheDir = process.env.GEO_CACHE_DIR || join(root, '.geo-cache');
async function verifiedSource(source, url) {
  const cached = join(cacheDir, source.sha256);
  try {
    const bytes = await readFile(cached);
    if (bytes.length === source.bytes && sha256(bytes) === source.sha256) return bytes;
  } catch { /* not cached yet */ }
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length !== source.bytes) throw new Error(`size ${bytes.length} ≠ pinned ${source.bytes}`);
      const digest = sha256(bytes);
      if (digest !== source.sha256) throw new Error(`SHA-256 ${digest} ≠ pinned ${source.sha256}`);
      await mkdir(cacheDir, {recursive: true});
      await writeFile(cached, bytes);
      return bytes;
    } catch (error) {
      lastError = error;
      if (/≠ pinned/.test(error.message)) break; // wrong bytes are never retried into acceptance
    }
  }
  throw new Error(`Refusing to build: ${url} could not be verified (${lastError.message}).`);
}
let geoBytes = 0;
for (const [iso3, level] of BUNDLED_GEO) {
  const source = COUNTRIES.find(c => c.iso3 === iso3)?.levels.find(l => l.level === level);
  if (!source) throw new Error(`Bundled geography ${iso3}/${level} is missing from world-catalog.js.`);
  const bytes = await verifiedSource(source, `${REMOTE_GEO_ROOT(GEOBOUNDARIES_COMMIT)}/${iso3}/${level}/${source.file}`);
  const destination = join(dist, BUNDLED_GEO_ROOT, iso3, level, source.file);
  await mkdir(dirname(destination), {recursive: true});
  await writeFile(destination, bytes);
  const written = await readFile(destination);
  if (written.length !== source.bytes || sha256(written) !== source.sha256) throw new Error(`Copy of ${source.file} does not match its source.`);
  geoBytes += (await stat(destination)).size;
}
console.log(`Static website ready in dist (${files.length} public files + ${BUNDLED_GEO.length} verified geoBoundaries files, ${(geoBytes / 1e6).toFixed(1)} MB).`);
