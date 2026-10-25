/*
 * MAINTENANCE TOOL — not part of `npm run build` and never published.
 *
 * Regenerates assets/js/world-catalog.js: the explicit ISO-country registry used by the
 * International Directory (names, codes, the deterministic country colour table, and the
 * pinned geoBoundaries subdivision sources with their byte sizes and SHA-256 digests).
 *
 * Inputs (all read-only):
 *   --geoboundaries <dir>  sparse clone of github.com/wmgeolab/geoBoundaries at GEOBOUNDARIES_COMMIT
 *                          (GIT_LFS_SKIP_SMUDGE=1; only LFS pointer files and the meta CSV are read)
 *   --atlas <file>         world-atlas@2.0.2 countries-50m.json (same file as assets/vendor)
 *   --iso <file>           i18n-iso-countries@7 codes.json ([alpha2, alpha3, numeric] rows)
 *   --names <file>         i18n-iso-countries@7 langs/en.json
 *
 * Country colours follow one fixed geographical itinerary, with no colour skipping and
 * no freezing of the previous incorrect, scattered assignments.
 */
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadVendorGlobals} from './lib/vendor-globals.mjs';
import {COUNTRY_COLOR_ORDER} from './world-country-order.mjs';
import {WORLD_PALETTE} from './world-palette.mjs';
import {ANTARCTICA_ICE} from '../assets/js/world-colors.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const {topojson} = loadVendorGlobals(root);

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => {
  if (value.startsWith('--')) pairs.push([value.slice(2), all[index + 1]]);
  return pairs;
}, []));
for (const required of ['geoboundaries', 'atlas', 'iso', 'names']) {
  if (!args[required]) throw new Error('Missing --' + required);
}

export const GEOBOUNDARIES_COMMIT = '5c25134028196d43ce97b5071934fd0cfc92f09f';

/* The complete ordered palette lives in world-palette.mjs, which also preserves
 * the original reference-image samples. No runtime shade generation. */
const PALETTE = WORLD_PALETTE;

/* Shapes in world-atlas without an ISO 3166-1 numeric id (Natural Earth ADM0_A3 codes). */
const NON_ISO = {
  'Kosovo': {iso3: 'XKX', iso2: 'XK', name: 'Kosovo'},
  'Somaliland': {iso3: 'SOL', iso2: null, name: 'Somaliland', noDirectory: true},
  'N. Cyprus': {iso3: 'CYN', iso2: null, name: 'Northern Cyprus', noDirectory: true},
  'Indian Ocean Ter.': {iso3: 'IOA', iso2: null, name: 'Indian Ocean Territories', noDirectory: true},
  'Siachen Glacier': {iso3: 'KAS', iso2: null, name: 'Siachen Glacier', noDirectory: true}
};

const hex = value => [1, 3, 5].map(i => parseInt(value.slice(i, i + 2), 16));
const toHex = rgb => '#' + rgb.map(v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
const mix = (a, b, t) => toHex(hex(a).map((v, i) => v + (hex(b)[i] - v) * t));
/* Advance to exactly the next explicit shade for the next geographic country. */
function paletteSequence() {
  const families = Object.entries(PALETTE);
  const all = families.flatMap(([family, row]) => row.map((color, i) => ({color, family, source: `${family} ${i + 1}`})));
  if (families.length !== 25 || families.some(([, row]) => row.length !== 10) ||
      new Set(all.map(entry => entry.color)).size !== 250) {
    throw new Error('Expected 25 color families with 10 globally distinct hex shades each.');
  }
  return all;
}

function luminance(value) {
  const [r, g, b] = hex(value).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/* Colour states derived from one assigned swatch. Very dark swatches get a lighter glow and
 * outline so the lighting stays visible on the navy background. `accent` is the middle swatch of
 * the same palette family; subdivision shades ramp between the country colour and it. */
function colorStates(base, family) {
  let glow = base;
  while (luminance(glow) < 0.32) glow = mix(glow, '#FFFFFF', 0.2);
  const light = luminance(base) > 0.75;
  return {
    fill: base,
    hover: light ? mix(base, '#7DD3FC', 0.18) : mix(base, '#FFFFFF', 0.28),
    selected: light ? base : mix(base, '#FFFFFF', 0.12),
    outline: mix(glow, '#FFFFFF', 0.55),
    glow,
    accent: PALETTE[family][luminance(base) > 0.4 ? 5 : 2]
  };
}

function pointerInfo(file) {
  const text = readFileSync(file, 'utf8');
  const oid = /oid sha256:([0-9a-f]{64})/.exec(text);
  const size = /size (\d+)/.exec(text);
  if (!oid || !size) throw new Error('Not a Git LFS pointer: ' + file);
  return {sha256: oid[1], bytes: Number(size[1])};
}
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows;
  return body.map(values => Object.fromEntries(header.map((key, i) => [key, values[i]])));
}

const gbRoot = join(args.geoboundaries, 'releaseData');
const meta = new Map(parseCsv(readFileSync(join(gbRoot, 'geoBoundariesOpen-meta.csv'), 'utf8'))
  .map(row => [row.boundaryISO + '/' + row.boundaryType, row]));
const atlas = JSON.parse(readFileSync(args.atlas, 'utf8'));
const isoRows = JSON.parse(readFileSync(args.iso, 'utf8'));
const byNumeric = new Map(isoRows.map(([a2, a3, num]) => [num, {iso2: a2, iso3: a3}]));
const englishNames = JSON.parse(readFileSync(args.names, 'utf8')).countries;
const features = topojson.feature(atlas, atlas.objects.countries).features;

const countries = new Map();
features.forEach((feature, index) => {
  let info;
  if (feature.id && byNumeric.has(feature.id)) {
    const {iso2, iso3} = byNumeric.get(feature.id);
    const name = meta.get(iso3 + '/ADM0')?.boundaryName || [].concat(englishNames[iso2] || [])[0] || feature.properties.name;
    info = {iso3, iso2, numeric: feature.id, name};
  } else if (NON_ISO[feature.properties.name]) {
    info = {...NON_ISO[feature.properties.name], numeric: null};
  } else throw new Error('Unmapped world-atlas feature: ' + feature.properties.name);
  const entry = countries.get(info.iso3) || {...info, atlasNames: [], indexes: []};
  entry.atlasNames.push(feature.properties.name);
  entry.indexes.push(index);
  countries.set(info.iso3, entry);
});
countries.get('USA').name = 'United States';
countries.get('ATA').name = 'Antarctica'; // source metadata misspells it

/* Pinned geoBoundaries subdivision sources (ADM1–ADM3, simplified GeoJSON as published). */
const LEVELS = ['ADM1', 'ADM2', 'ADM3'];
/* Readable level names for the hierarchies the owner named explicitly; others use the source's
 * canonical name when it is a usable label. */
const LABEL_OVERRIDES = {
  CAN: ['Province/Territory', 'Census division', 'Census subdivision'],
  MEX: ['State', 'Municipality'],
  DEU: ['Federal state', 'Government district', 'District'],
  GBR: ['Constituent country', 'County / unitary authority'],
  AUS: ['State/Territory', 'Local government area']
};
function levelLabel(iso3, index, canonical, countryName) {
  if (LABEL_OVERRIDES[iso3]?.[index]) return LABEL_OVERRIDES[iso3][index];
  const text = String(canonical || '').trim();
  if (!text || /^(unknown|gbopen|country)$/i.test(text) || text === countryName || text.length > 40) return null;
  return text.charAt(0).toUpperCase() + text.slice(1);
}
for (const entry of countries.values()) {
  entry.levels = [];
  if (entry.iso3 === 'USA' || entry.noDirectory) continue;
  for (const level of LEVELS) {
    const file = `geoBoundaries-${entry.iso3}-${level}_simplified.geojson`;
    const path = join(gbRoot, 'gbOpen', entry.iso3, level, file);
    if (!existsSync(path)) break; // hierarchy stops at the first missing level
    const row = meta.get(entry.iso3 + '/' + level) || {};
    const pinned = pointerInfo(path);
    const previous = entry.levels.at(-1);
    const previousRow = previous ? meta.get(entry.iso3 + '/' + previous.level) || {} : null;
    // A level that republishes the previous one (same bytes, or same unit type and count) adds no depth.
    if (previous && (previous.sha256 === pinned.sha256 ||
      (previous.units === (Number(row.admUnitCount) || null) && previousRow.boundaryCanonical === row.boundaryCanonical))) break;
    entry.levels.push({
      level,
      label: levelLabel(entry.iso3, entry.levels.length, row.boundaryCanonical, entry.name),
      file,
      ...pinned,
      units: Number(row.admUnitCount) || null,
      year: row.boundaryYearRepresented || null,
      source: row.boundarySource || null,
      license: row.boundaryLicense || null
    });
  }
}

/* Geographic route is fixed and documented; colour source order is never overridden
 * by contrast optimization or an unreviewed nearest-country traversal. */
const allowed = new Set([...countries.keys()].filter(iso3 => iso3 !== 'USA'));
if (COUNTRY_COLOR_ORDER.length !== allowed.size || new Set(COUNTRY_COLOR_ORDER).size !== allowed.size ||
    COUNTRY_COLOR_ORDER.some(iso3 => !allowed.has(iso3))) {
  throw new Error('Geographic palette order must include each non-USA country exactly once.');
}
/* Special cases outside the numbered palette: the U.S. (grey, redirect) and Antarctica (ice-white).
 * Antarctica stays in the itinerary file; it is simply not numbered. */
const SPECIAL_COLORS = {ATA: {color: ANTARCTICA_ICE.fill, source: 'special antarctica-ice', states: ANTARCTICA_ICE}};
const NUMBERED_ORDER = COUNTRY_COLOR_ORDER.filter(iso3 => !SPECIAL_COLORS[iso3]);
const sequence = paletteSequence();
if (sequence.length < NUMBERED_ORDER.length) throw new Error('Insufficient distinct ordered shades.');
const assigned = new Map(NUMBERED_ORDER.map((iso3, index) => {
  const entry = sequence[index];
  return [iso3, {color: entry.color, source: entry.source}];
}));
for (const [iso3, special] of Object.entries(SPECIAL_COLORS)) assigned.set(iso3, special);

const ordered = [...countries.values()].sort((a, b) => a.iso3.localeCompare(b.iso3)).map(c => {
  const color = c.iso3 === 'USA' ? null : assigned.get(c.iso3);
  return {
    iso3: c.iso3, iso2: c.iso2, numeric: c.numeric, name: c.name, atlasNames: c.atlasNames,
    ...(c.iso3 === 'USA' ? {redirect: '/'} : {}),
    ...(c.noDirectory ? {noDirectory: true} : {}),
    color: color?.color || null,
    colorSource: color?.source || null,
    states: color ? (color.states ? {...color.states} : colorStates(color.color, color.source.split(' ')[0])) : null,
    levels: c.levels
  };
});

const catalogPath = join(root, 'assets/js/world-catalog.js');
const output = `/* GENERATED by scripts/generate-world-catalog.mjs — edit the generator, not this file.
 * Explicit ISO-country registry for the International Directory:
 *  - deterministic sequential colours following the fixed geographic itinerary,
 *  - pinned geoBoundaries (gbOpen) subdivision files with exact byte sizes and SHA-256 digests.
 * The United States is intentionally uncoloured (muted grey) and redirects to the U.S. directory;
 * Antarctica is fixed ice-white outside the numbered palette. */
export const GEOBOUNDARIES_COMMIT = '${GEOBOUNDARIES_COMMIT}';
export const PALETTE = ${JSON.stringify(PALETTE)};
export const COUNTRIES = [
${ordered.map(c => JSON.stringify(c)).join(',\n')}
];
`;
writeFileSync(catalogPath, output);
console.log(`Wrote ${ordered.length} countries (${ordered.filter(c => c.levels.length).length} with subdivisions) to ${catalogPath}`);
console.log('Opening order:', NUMBERED_ORDER.slice(0, 12).map(i => `${i}=${assigned.get(i).color}`).join(' '));
