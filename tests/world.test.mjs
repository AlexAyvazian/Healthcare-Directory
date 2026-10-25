import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {COUNTRIES, PALETTE, GEOBOUNDARIES_COMMIT} from '../assets/js/world-catalog.js';
import {regionStates, countryStates, US_GREY, ANTARCTICA_ICE, colorDistance} from '../assets/js/world-colors.js';
import {singularLabel, plural} from '../assets/js/world-labels.js';
import {COUNTRY_COLOR_ORDER, COUNTRY_COLOR_GROUPS} from '../scripts/world-country-order.mjs';
import {WORLD_PALETTE, WORLD_FAMILY_ORDER} from '../scripts/world-palette.mjs';
import {buildFacilityQuery, listFacilities, listCategories, cleanSearch, regionCondition, resetTokenCache, PUBLIC_COLUMNS} from '../assets/js/world-data.js';
import {WORLD_DATA_API_URL, WORLD_AUTH_URL, BUNDLED_GEO} from '../assets/js/world-config.js';
import {orientForD3, prepareFeatures, assignParents, loadLevel, regionCodes, geoUrl} from '../assets/js/world-geo.js';
import {loadVendorGlobals} from '../scripts/lib/vendor-globals.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const {d3, topojson} = loadVendorGlobals(root);
const country = iso3 => COUNTRIES.find(c => c.iso3 === iso3);

/* ---------------- Canada boundary pin ---------------- */
test('Canada ADM1 is pinned to the original 26,022,306-byte geoBoundaries file and its SHA-256', () => {
  const adm1 = country('CAN').levels[0];
  assert.equal(adm1.level, 'ADM1');
  assert.equal(adm1.file, 'geoBoundaries-CAN-ADM1_simplified.geojson');
  assert.equal(adm1.bytes, 26022306);
  assert.equal(adm1.sha256, '0c9e4fc56c8b9ce958960ffabd1556fbe7c3ec0deeea346a2b5b7dff05e35449');
  assert.match(GEOBOUNDARIES_COMMIT, /^[0-9a-f]{40}$/, 'source pinned to an immutable full commit hash');
  assert.ok(BUNDLED_GEO.some(([iso3, level]) => iso3 === 'CAN' && level === 'ADM1'), 'Canada is copied into the static site');
});

test('every subdivision source is pinned by size and SHA-256 and the hierarchy is ordered', () => {
  for (const c of COUNTRIES) {
    c.levels.forEach((level, i) => {
      assert.equal(level.level, 'ADM' + (i + 1), c.iso3);
      assert.match(level.sha256, /^[0-9a-f]{64}$/);
      assert.ok(Number.isSafeInteger(level.bytes) && level.bytes > 0);
      assert.equal(level.file, `geoBoundaries-${c.iso3}-${level.level}_simplified.geojson`);
    });
  }
  assert.deepEqual(country('MEX').levels.map(l => l.level), ['ADM1', 'ADM2'], 'Mexico: state → municipality');
  assert.deepEqual(country('DEU').levels.map(l => l.level), ['ADM1', 'ADM2', 'ADM3'], 'Germany: federal state → districts');
  assert.ok(COUNTRIES.some(c => !c.redirect && !c.noDirectory && c.levels.length === 0), 'countries without subdivisions exist and are handled');
});

/* ---------------- Country colours ---------------- */
test('expanded palette contains 25 ordered hue families and 10 distinct shades per family', () => {
  assert.deepEqual(Object.keys(PALETTE), WORLD_FAMILY_ORDER);
  assert.deepEqual(PALETTE, WORLD_PALETTE);
  assert.equal(Object.keys(PALETTE).length, 25);
  assert.deepEqual(Object.values(PALETTE).map(row => row.length), Array(25).fill(10));
  const shades = Object.values(PALETTE).flat();
  assert.equal(shades.length, 250);
  assert.equal(new Set(shades).size, 250, 'not one duplicate across the entire palette');
  assert.ok(shades.every(color => /^#[0-9A-F]{6}$/.test(color)));
});

test('original nine source shades are retained for all original reference families', () => {
  assert.deepEqual(PALETTE.blue.slice(0, 9), ['#ECFEFF','#74CBF5','#65A8E5','#5CA6F1','#589AEF','#3C57D4','#4063C7','#2B45AE','#131C79']);
  assert.deepEqual(['blue','teal','green','yellow','orange','red','pink','purple','neutral'].map(family => PALETTE[family].length), Array(9).fill(10));
});


test('opening colour progression: Canada, Mexico, Guatemala get blue shades 1, 2, 3', () => {
  assert.equal(country('CAN').color, PALETTE.blue[0]);
  assert.equal(country('MEX').color, PALETTE.blue[1]);
  assert.equal(country('GTM').color, PALETTE.blue[2]);
  assert.deepEqual([country('CAN'), country('MEX'), country('GTM')].map(c => c.colorSource), ['blue 1', 'blue 2', 'blue 3']);
});

test('United States is muted grey, uses no palette colour, and redirects to the U.S. directory', () => {
  const us = country('USA');
  assert.equal(us.color, null);
  assert.equal(us.redirect, '/');
  assert.deepEqual(us.levels, []);
  assert.deepEqual(countryStates(us), US_GREY);
});

test('Antarctica is a fixed ice-white special case outside the numbered palette', () => {
  const ata = country('ATA');
  assert.equal(ata.color, '#F4F8FC');
  assert.equal(ata.colorSource, 'special antarctica-ice');
  assert.deepEqual(ata.states, {...ANTARCTICA_ICE});
  assert.deepEqual(countryStates(ata), {...ANTARCTICA_ICE});
  assert.ok(!Object.values(PALETTE).flat().includes(ata.color), 'ice-white is not a palette swatch');
  assert.notEqual(ata.states.glow, ata.states.fill, 'hover/selection glow stays visible against white');
});

test('purple is consumed by ordinary countries, not only remote islands', () => {
  assert.equal(WORLD_FAMILY_ORDER.indexOf('purple'), 21, 'purple is the 22nd family');
  for (const iso3 of ['PNG', 'AUS', 'NZL', 'NCL']) assert.equal(country(iso3).colorSource.split(' ')[0], 'purple', iso3);
  assert.equal(country('AUS').colorSource, 'purple 5');
});

test('every directory country has its own colour and its own hover/selected/outline/glow states', () => {
  const coloured = COUNTRIES.filter(c => c.iso3 !== 'USA' && c.iso3 !== 'ATA');
  const colours = coloured.map(c => c.color);
  assert.equal(new Set(colours).size, colours.length, 'no two countries share a colour');
  const families = new Set(Object.keys(PALETTE));
  for (const c of coloured) {
    assert.match(c.color, /^#[0-9A-F]{6}$/);
    assert.ok(families.has(c.colorSource.split(' ')[0]), `${c.iso3} colour comes from a palette family`);
    for (const key of ['fill', 'hover', 'selected', 'outline', 'glow', 'accent']) assert.match(c.states[key], /^#[0-9A-F]{6}$/, `${c.iso3}.${key}`);
    assert.equal(c.states.fill, c.color);
  }
  const glows = new Set(coloured.map(c => c.states.glow));
  assert.ok(glows.size > 200, 'glow is country-specific, not one universal colour');
});

test('geographic palette itinerary contains every non-USA country once in the intended order', () => {
  const iso = COUNTRIES.filter(c => c.iso3 !== 'USA').map(c => c.iso3).sort();
  assert.equal(COUNTRY_COLOR_ORDER.length, iso.length);
  assert.deepEqual([...COUNTRY_COLOR_ORDER].sort(), iso);
  assert.deepEqual(COUNTRY_COLOR_GROUPS[0], ['CAN','MEX','GTM','BLZ','HND','SLV','NIC','CRI','PAN']);
  assert.deepEqual(COUNTRY_COLOR_ORDER.slice(9,12), ['COL','ECU','PER']);
});

test('every country consumes one next explicit palette shade without interpolation or geographic shuffling', () => {
  const expected = Object.entries(PALETTE).flatMap(([family, row]) =>
    row.map((color, i) => ({color, source: `${family} ${i + 1}`})));
  const byIso = new Map(COUNTRIES.map(c => [c.iso3, c]));
  const numbered = COUNTRY_COLOR_ORDER.filter(iso => iso !== 'ATA'); // Antarctica is special-cased
  assert.deepEqual(numbered, COUNTRY_COLOR_ORDER.slice(0, -1), 'Antarctica is the final itinerary entry, so no other position shifts');
  numbered.forEach((iso, index) => {
    assert.equal(byIso.get(iso).color, expected[index].color, `${iso}: incorrect fixed palette shade ${index + 1}`);
    assert.equal(byIso.get(iso).colorSource, expected[index].source, `${iso}: color source is not next palette shade`);
  });
  assert.deepEqual(COUNTRY_COLOR_ORDER.slice(0,10).map(iso => byIso.get(iso).colorSource),
    ['blue 1','blue 2','blue 3','blue 4','blue 5','blue 6','blue 7','blue 8','blue 9','blue 10']);
  const families = numbered.map(iso => byIso.get(iso).colorSource.split(' ')[0]);
  const runs = families.reduce((out, family) => {
    if (out.at(-1)?.family === family) out.at(-1).count++;
    else out.push({family, count:1});
    return out;
  }, []);
  assert.deepEqual(runs.map(r => r.family), WORLD_FAMILY_ORDER.slice(0,24), 'palette families must never recur later elsewhere');
  assert.ok(runs.slice(0,-1).every(r => r.count === 10), 'all complete hue groups must use exactly ten countries');
  assert.equal(runs.at(-1).count, 8, '238 numbered countries consume 23 full groups and 8 shades of group 24');
  assert.equal(expected.length - numbered.length, 12, 'twelve shades remain for future entries');
});

test('subdivision shades are deterministic and keep the country lighting identity', () => {
  const can = country('CAN');
  const a = regionStates(can, 3, 13), b = regionStates(can, 3, 13);
  assert.deepEqual(a, b);
  assert.equal(a.glow, can.states.glow);
  const fills = new Set(Array.from({length: 13}, (_, i) => regionStates(can, i, 13).fill));
  assert.ok(fills.size >= 10, 'regions get distinguishable shades');
  assert.notEqual(regionStates(can, 0, 13).selected, regionStates(can, 0, 13).fill, 'selected region stands out');
});

test('every country\'s subdivisions get clearly distinguishable shades of its own colour', () => {
  for (const c of COUNTRIES.filter(x => x.states)) {
    const fills = Array.from({length: 12}, (_, i) => regionStates(c, i, 12).fill);
    let spread = 0;
    for (const a of fills) for (const b of fills) spread = Math.max(spread, colorDistance(a, b));
    assert.ok(spread >= 0.12, `${c.iso3} subdivision shades too similar (spread ${spread.toFixed(3)})`);
    for (const n of [5, 13, 16, 32, 47]) {
      const shades = new Set(Array.from({length: n}, (_, i) => regionStates(c, i, n).fill));
      assert.ok(shades.size >= Math.min(n, 12), `${c.iso3}: ${shades.size} distinct shades for ${n} regions`);
    }
    assert.equal(regionStates(c, 0, 12).glow, c.states.glow, `${c.iso3} regions glow in the country colour`);
  }
});

test('source level names are shown in grammatical singular and counted plural forms', () => {
  assert.equal(singularLabel('Prefectures'), 'Prefecture');
  assert.equal(singularLabel('Counties and Unitary Authorities'), 'County and Unitary Authority');
  assert.equal(singularLabel('Parishes'), 'Parish');
  assert.equal(singularLabel('Province/Territory'), 'Province/Territory');
  assert.equal(singularLabel('Bundesländer'), 'Bundesländer', 'non-English names unchanged');
  assert.equal(singularLabel('Regiões'), 'Regiões');
  assert.equal(singularLabel('Okres'), 'Okres');
  assert.equal(plural(47, 'prefecture'), '47 prefectures');
  assert.equal(plural(13, 'province/territory'), '13 province/territories');
  assert.equal(plural(1, 'state'), '1 state');
  assert.equal(plural(569, 'municipality'), '569 municipalities');
  assert.equal(plural(14, 'parish'), '14 parishes');
});

/* ---------------- Neon Data API client ---------------- */
test('international API endpoints are public HTTPS URLs, never database credentials', () => {
  for (const url of [WORLD_DATA_API_URL, WORLD_AUTH_URL]) {
    assert.match(url, /^https:\/\/ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech\/neondb\//);
    assert.doesNotMatch(url, /postgres(ql)?:\/\/|npg_|password=/);
  }
  assert.notEqual(WORLD_DATA_API_URL, 'https://ep-bitter-breeze-b4mo7ule.apirest.c-6.us-east-2.aws.neon.tech/neondb/rest/v1', 'separate from the U.S. database');
});

test('facility queries request only published public fields, scoped and paginated', () => {
  const url = buildFacilityQuery({country: 'CAN', region: {name: 'British Columbia', codes: ['CA-BC', 'SHAPE1'], ancestors: []}, category: 'hospital', search: 'St. Paul', page: 3, perPage: 50});
  const select = url.searchParams.get('select').split(',');
  assert.deepEqual(select, PUBLIC_COLUMNS.split(','));
  for (const hidden of ['search_document', 'latitude', 'longitude', 'metadata', 'published', 'source_record_id']) assert.ok(!select.includes(hidden), hidden);
  assert.equal(url.pathname.endsWith('/facilities'), true);
  assert.equal(url.searchParams.get('country_iso3'), 'eq.CAN');
  assert.equal(url.searchParams.get('category'), 'eq.hospital');
  assert.equal(url.searchParams.get('and'), '(or(admin_path.cs.{"CA-BC"},admin_path.cs.{"SHAPE1"},admin_names.cs.{"British Columbia"}),or(name.ilike."*St. Paul*",city.ilike."*St. Paul*"))');
  assert.equal(url.searchParams.get('limit'), '51');
  assert.equal(url.searchParams.get('offset'), '100');
  assert.equal(url.searchParams.get('order'), 'name.asc,id.asc');
});

test('deeper regions match by code or by the full ancestor name chain', () => {
  assert.equal(regionCondition({name: 'Aguascalientes', codes: ['MEX-ADM2-1'], ancestors: ['Aguascalientes']}),
    'or(admin_path.cs.{"MEX-ADM2-1"},and(admin_names.cs.{"Aguascalientes"},admin_names.cs.{"Aguascalientes"}))');
  assert.equal(regionCondition(null), null);
});

test('user search text cannot inject PostgREST operators', () => {
  assert.equal(cleanSearch('a,b)(c"d\\e*f%g_h:i{j}'), 'a b c d e f g h i j');
  assert.equal(cleanSearch('x'.repeat(200)).length, 80);
  const url = buildFacilityQuery({country: 'MEX', search: 'clinic),or(name.not.is.null'});
  assert.equal(url.searchParams.get('and'), '(or(name.ilike."*clinic or name.not.is.null*",city.ilike."*clinic or name.not.is.null*"))');
});

test('query builder validates country, page, and page size', () => {
  assert.throws(() => buildFacilityQuery({country: 'ca'}), /country/);
  assert.throws(() => buildFacilityQuery({country: 'CAN', page: 0}), /page/);
  assert.throws(() => buildFacilityQuery({country: 'CAN', perPage: 101}), /page size/);
});

function fakeNeon(pages) {
  const calls = [];
  const jwt = (exp) => ['e30', Buffer.from(JSON.stringify({role: 'anonymous', exp})).toString('base64url'), 'sig'].join('.');
  const fetchImpl = async (url, options = {}) => {
    calls.push({url: String(url), options});
    if (String(url).endsWith('/token/anonymous')) return {ok: true, status: 200, json: async () => ({token: jwt(Math.floor(Date.now() / 1000) + 3600)})};
    const next = pages.shift();
    return {ok: next.status < 300, status: next.status, headers: {get: () => next.range}, json: async () => next.body};
  };
  return {fetchImpl, calls};
}

test('Data API reads use an anonymous session token and only GET requests', async () => {
  resetTokenCache();
  const rows = Array.from({length: 51}, (_, i) => ({id: i, name: 'FIXTURE facility ' + i}));
  const neon = fakeNeon([{status: 200, range: '0-50/120', body: rows}]);
  const out = await listFacilities({country: 'CAN', perPage: 50}, {fetchImpl: neon.fetchImpl});
  assert.equal(out.facilities.length, 50);
  assert.equal(out.total, 120);
  assert.equal(out.has_more, true);
  assert.equal(neon.calls[0].url, WORLD_AUTH_URL + '/token/anonymous');
  assert.match(neon.calls[1].options.headers.Authorization, /^Bearer e30\./);
  assert.ok(neon.calls.every(c => (c.options.method || 'GET') === 'GET'));
  assert.ok(neon.calls.every(c => c.options.credentials === 'omit'));
});

test('expired sessions refresh once; pages past the end are empty, not errors', async () => {
  resetTokenCache();
  const neon = fakeNeon([{status: 401, range: '', body: {}}, {status: 416, range: '*/0', body: {}}]);
  const out = await listFacilities({country: 'MEX', page: 4}, {fetchImpl: neon.fetchImpl});
  assert.deepEqual(out, {facilities: [], page: 4, total: 0, has_more: false});
  assert.equal(neon.calls.filter(c => c.url.endsWith('/token/anonymous')).length, 2);
});

test('empty database: zero facilities and zero categories are a normal state', async () => {
  resetTokenCache();
  const neon = fakeNeon([{status: 200, range: '*/0', body: []}, {status: 200, range: '*/0', body: []}]);
  assert.deepEqual(await listFacilities({country: 'CAN'}, {fetchImpl: neon.fetchImpl}), {facilities: [], page: 1, total: 0, has_more: false});
  assert.deepEqual(await listCategories('CAN', {fetchImpl: neon.fetchImpl}), []);
  assert.match(neon.calls.at(-1).url, /\/category_counts\?select=category%2Ctotal&country_iso3=eq\.CAN/);
});

test('server errors surface as errors so the sidebar can offer a retry', async () => {
  resetTokenCache();
  const neon = fakeNeon([{status: 503, range: '', body: {}}]);
  await assert.rejects(listFacilities({country: 'CAN'}, {fetchImpl: neon.fetchImpl}), /503/);
});

/* ---------------- Geometry loading (fixture geometry, clearly synthetic) ---------------- */
const square = (x0, y0, x1, y1, ccw = true) => {
  const ring = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
  return ccw ? ring : ring.slice().reverse();
};
test('RFC 7946 (counter-clockwise) rings are oriented for d3 in memory without changing vertices', () => {
  const geometry = {type: 'Polygon', coordinates: [square(0, 0, 2, 2)]};
  assert.ok(d3.geoArea(geometry) > 2 * Math.PI, 'd3 would read the raw ring as the whole globe minus a square');
  const oriented = orientForD3(geometry, d3);
  assert.ok(d3.geoArea(oriented) < 0.01);
  assert.deepEqual(oriented.coordinates[0].slice().sort(), geometry.coordinates[0].slice().sort(), 'same vertex set');
  assert.deepEqual(geometry.coordinates[0], square(0, 0, 2, 2), 'input is not mutated');
});

test('region codes prefer ISO 3166-2 then geoBoundaries shapeID', () => {
  assert.deepEqual(regionCodes({shapeISO: 'CA-BC', shapeID: 'X1'}), ['CA-BC', 'X1']);
  assert.deepEqual(regionCodes({shapeISO: '', shapeID: 'X2'}), ['X2']);
});

test('child regions are assigned to the parent region that contains them', () => {
  const parents = prepareFeatures({type: 'FeatureCollection', features: [
    {type: 'Feature', properties: {shapeName: 'FIXTURE West', shapeID: 'W'}, geometry: {type: 'Polygon', coordinates: [square(0, 0, 10, 10)]}},
    {type: 'Feature', properties: {shapeName: 'FIXTURE East', shapeID: 'E'}, geometry: {type: 'Polygon', coordinates: [square(10, 0, 20, 10)]}}
  ]}, 'ADM1', d3);
  const children = prepareFeatures({type: 'FeatureCollection', features: [
    {type: 'Feature', properties: {shapeName: 'w1', shapeID: 'w1'}, geometry: {type: 'Polygon', coordinates: [square(1, 1, 4, 4)]}},
    {type: 'Feature', properties: {shapeName: 'e1', shapeID: 'e1'}, geometry: {type: 'Polygon', coordinates: [square(12, 2, 18, 8)]}},
    {type: 'Feature', properties: {shapeName: 'e2 (L-shape)', shapeID: 'e2'}, geometry: {type: 'Polygon', coordinates: [[[10, 0], [20, 0], [20, 1], [11, 1], [11, 9], [10, 9], [10, 0]]]}}
  ]}, 'ADM2', d3);
  const map = assignParents(children, parents, d3);
  assert.equal(map.get('ADM2:w1'), 'ADM1:W');
  assert.equal(map.get('ADM2:e1'), 'ADM1:E');
  assert.equal(map.get('ADM2:e2'), 'ADM1:E');
});

test('boundary files are verified against the pinned digest before use', async () => {
  const body = Buffer.from(JSON.stringify({type: 'FeatureCollection', features: [{type: 'Feature', properties: {shapeName: 'FIXTURE region', shapeISO: 'XX-01', shapeID: 'F1'}, geometry: {type: 'Polygon', coordinates: [square(0, 0, 1, 1)]}}]}));
  const source = {level: 'ADM1', file: 'fixture.geojson', bytes: body.length, sha256: createHash('sha256').update(body).digest('hex')};
  const ok = async () => ({ok: true, status: 200, body: null, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length)});
  const features = await loadLevel('ZZZ', source, d3, {fetchImpl: ok});
  assert.equal(features[0].name, 'FIXTURE region');
  assert.deepEqual(features[0].codes, ['XX-01', 'F1']);
  await assert.rejects(loadLevel('ZZY', {...source, sha256: source.sha256.replace(/^./, c => (c === '0' ? '1' : '0'))}, d3, {fetchImpl: ok}), /checksum/);
  const other = Buffer.from(body.toString().replace('FIXTURE region', 'FIXTURE regioN'));
  const tampered = Buffer.from(other); tampered[20] ^= 1; // same length, one flipped bit
  const bad = async () => ({ok: true, status: 200, body: null, arrayBuffer: async () => tampered.buffer.slice(tampered.byteOffset, tampered.byteOffset + tampered.length)});
  await assert.rejects(loadLevel('ZZX', {...source, sha256: createHash('sha256').update(other).digest('hex')}, d3, {fetchImpl: bad}), /checksum/);
  const short = async () => ({ok: true, status: 200, body: null, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length - 1)});
  await assert.rejects(loadLevel('ZZW', {...source, sha256: createHash('sha256').update('x').digest('hex')}, d3, {fetchImpl: short}), /size/);
});

test('bundled geography is served locally; other countries from the pinned geoBoundaries commit', () => {
  assert.equal(geoUrl('CAN', country('CAN').levels[0]), '/geo/gbOpen/CAN/ADM1/geoBoundaries-CAN-ADM1_simplified.geojson');
  assert.equal(geoUrl('FRA', country('FRA').levels[0]), `https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/${GEOBOUNDARIES_COMMIT}/releaseData/gbOpen/FRA/ADM1/geoBoundaries-FRA-ADM1_simplified.geojson`);
});

/* ---------------- No pins ---------------- */
test('the international map code draws regions only — no pins, markers, dots, or coordinates', async () => {
  const source = await readFile(join(root, 'assets/js/world-map.js'), 'utf8');
  assert.doesNotMatch(source, /append\(['"](circle|image|use|text)['"]\)/);
  assert.doesNotMatch(source, /\b(latitude|longitude|marker|cluster)\b/i);
  const css = await readFile(join(root, 'assets/css/world.css'), 'utf8');
  assert.doesNotMatch(css, /\b(pin|marker)\b/i);
});
