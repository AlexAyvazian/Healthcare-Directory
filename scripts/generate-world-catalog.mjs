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

/* Sampled from the user's original 9×9 palette screenshot (mode colour of each chip interior,
 * which ignores the semi-transparent watermark). The screenshot remains the visual authority. */
const PALETTE = {
  blue:    ['#ECFEFF','#74CBF5','#65A8E5','#5CA6F1','#589AEF','#3C57D4','#4063C7','#2B45AE','#131C79'],
  teal:    ['#F2FEFF','#ACFAF1','#A2F2EB','#7FDFD1','#66C9BD','#376F78','#326C77','#265067','#1D4250'],
  green:   ['#F6FEF2','#C0FB74','#B5F16E','#86ED4E','#80E148','#62B035','#599E31','#3E7B22','#2F6419'],
  yellow:  ['#FFFED9','#FCEF6E','#F4E14B','#F2CE46','#C59A34','#AD932F','#8D7125','#7C5E1F','#6E571B'],
  orange:  ['#FBEA61','#F2A43B','#ED722F','#F09637','#E94E2C','#C65323','#A83F1A','#852B15','#8B2A14'],
  red:     ['#F1A38A','#E74A41','#EA3A2E','#ED7147','#B12A19','#E04033','#A82517','#881B18','#5D101E'],
  pink:    ['#F9D9EF','#F19DC7','#E46CAD','#EA8CAE','#B13C72','#9A416B','#963762','#7D2349','#7D195D'],
  purple:  ['#F9DAFA','#DC64D4','#DC68D1','#AB41A6','#8B3398','#81298F','#73228B','#570D67','#540C69'],
  neutral: ['#DDD6DA','#856B81','#6B5C6E','#4B4754','#343A43','#260B1A','#150B09','#0C0603','#0F0601']
};

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
/* Each of nine palette families appears once in one continuous group: first its nine
 * source swatches, then nearby distinct derived shades, before moving on. This
 * prevents blue country fills from reappearing at random in Europe or elsewhere. */
function paletteSequence() {
  const out = [], seen = new Set();
  for (const [family, row] of Object.entries(PALETTE)) {
    const group = [];
    row.forEach((color, i) => group.push({color, family, source: `${family} ${i + 1}`}));
    for (const [t, count] of [[0.5, 8], [0.25, 8], [0.75, 2]]) {
      for (let i = 0; i < count; i++) group.push({
        color: mix(row[i], row[i + 1], t), family,
        source: t === 0.5 ? `${family} ${i + 1}½ (derived)` : `${family} ${i + 1 + t} (derived)`
      });
    }
    for (const entry of group) if (!seen.has(entry.color)) { out.push(entry); seen.add(entry.color); }
  }
  return out;
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
const sequence = paletteSequence();
if (sequence.length < COUNTRY_COLOR_ORDER.length) throw new Error('Insufficient distinct ordered shades.');
const assigned = new Map(COUNTRY_COLOR_ORDER.map((iso3, index) => {
  const entry = sequence[index];
  return [iso3, {color: entry.color, source: entry.source}];
}));

const ordered = [...countries.values()].sort((a, b) => a.iso3.localeCompare(b.iso3)).map(c => {
  const color = c.iso3 === 'USA' ? null : assigned.get(c.iso3);
  return {
    iso3: c.iso3, iso2: c.iso2, numeric: c.numeric, name: c.name, atlasNames: c.atlasNames,
    ...(c.iso3 === 'USA' ? {redirect: '/'} : {}),
    ...(c.noDirectory ? {noDirectory: true} : {}),
    color: color?.color || null,
    colorSource: color?.source || null,
    states: color ? colorStates(color.color, color.source.split(' ')[0]) : null,
    levels: c.levels
  };
});

const output = `/* GENERATED by scripts/generate-world-catalog.mjs — edit the generator, not this file.
 * Explicit ISO-country registry for the International Directory:
 *  - deterministic sequential colours following the fixed geographic itinerary,
 *  - pinned geoBoundaries (gbOpen) subdivision files with exact byte sizes and SHA-256 digests.
 * The United States is intentionally uncoloured (muted grey) and redirects to the U.S. directory. */
export const GEOBOUNDARIES_COMMIT = '${GEOBOUNDARIES_COMMIT}';
export const PALETTE = ${JSON.stringify(PALETTE)};
export const COUNTRIES = [
${ordered.map(c => JSON.stringify(c)).join(',\n')}
];
`;
writeFileSync(catalogPath, output);
console.log(`Wrote ${ordered.length} countries (${ordered.filter(c => c.levels.length).length} with subdivisions) to ${catalogPath}`);
console.log('Opening order:', COUNTRY_COLOR_ORDER.slice(0, 12).map(i => `${i}=${assigned.get(i).color}`).join(' '));
