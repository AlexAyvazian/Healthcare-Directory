/* Cloudflare Worker (worker/src) unit tests. Upstream registries are replaced by fixtures shaped
 * like their real responses; no network access. Fixture records are synthetic test data. */
import test from 'node:test';
import assert from 'node:assert/strict';
import worker, {_resetRateLimit, parseSearch} from '../worker/src/index.js';
import {_resetRolesCache} from '../worker/src/sources/gb-nhs-ods.js';
import {encodeCursor, decodeCursor} from '../worker/src/sources/fr-annuaire-sante.js';
import {readable} from '../worker/src/facility.js';
import {mxInegi} from '../worker/src/sources/mx-inegi.js';
import {_resetChasCache} from '../worker/src/sources/sg-chas.js';

const FRONTEND = 'https://healthcare-directory-u2l1.onrender.com';
const KEY = 'test-esante-key-0123456789';
const ENV = {FRONTEND_ORIGIN: FRONTEND};

/* ---------- fixtures (shapes recorded from the live NPPES / ODS APIs and the ANS FHIR docs) ---------- */
const nppesOrg = (number, name, desc = 'Clinic/Center, Multi-Specialty') => ({
  number, enumeration_type: 'NPI-2',
  basic: {organization_name: name, status: 'A', last_updated: '2024-01-02'},
  addresses: [
    {address_purpose: 'MAILING', address_1: 'PO BOX 1', city: 'ELSEWHERE', state: 'MN', postal_code: '55901', country_code: 'US'},
    {address_purpose: 'LOCATION', address_1: '200 FIRST ST SW', city: 'ROCHESTER', state: 'MN', postal_code: '559050001', country_code: 'US', telephone_number: '507-284-2511'}
  ],
  taxonomies: [{desc: 'Pharmacy', primary: false}, {desc, primary: true}],
  latitude: 44.02, longitude: -92.46
});
const odsRow = (id, name, role = 'PHARMACY') => ({Name: name, OrgId: id, Status: 'Active', PostCode: 'SE1 9RT', LastChangeDate: '2024-05-01', PrimaryRoleId: 'RO182', PrimaryRoleDescription: role, OrgLink: `https://directory.spineservices.nhs.uk/ORD/2-0-0/organisations/${id}`});
const ODS_ROLES = {Roles: [{id: 'RO182', displayName: 'PHARMACY'}, {id: 'RO197', displayName: 'NHS TRUST'}, {id: 'RO198', displayName: 'NHS TRUST SITE'}, {id: 'RO177', displayName: 'PRESCRIBING COST CENTRE'}]};
const fhirOrg = (id, name) => ({
  resourceType: 'Organization', id, active: true, name,
  identifier: [{system: 'urn:oid:1.2.250.1.71.4.2.2', value: `1${id}`, type: {coding: [{code: 'FINESS'}]}}],
  type: [{coding: [{display: 'Centre Hospitalier Universitaire (C.H.U.)'}]}],
  address: [{line: ['1 RUE DE LA PAIX'], city: 'BORDEAUX', postalCode: '33000'}],
  telecom: [{system: 'phone', value: '05 00 00 00 00'}, {system: 'url', value: 'www.example-chu.fr'}],
  meta: {lastUpdated: '2024-03-04T00:00:00Z'}
});

function mockFetch(routes) {
  const calls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(input);
    calls.push({url, headers: init.headers || {}, method: init.method});
    for (const [match, reply] of routes) {
      if (match(url)) {
        const {status = 200, body, headers = {}} = typeof reply === 'function' ? reply(url, init) : reply;
        return new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json', ...headers}});
      }
    }
    return new Response('{}', {status: 500});
  };
  return {fetchImpl, calls};
}
async function call(path, {env = ENV, origin = FRONTEND, method = 'GET', ip, fetchImpl, timeoutMs} = {}) {
  const headers = {'CF-Connecting-IP': ip || `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`};
  if (origin) headers.Origin = origin;
  const response = await worker.fetch(new Request(`https://healthcare-directory-api.example.workers.dev${path}`, {method, headers}), env, {fetchImpl, timeoutMs});
  const text = await response.text();
  return {status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null, text};
}
test.beforeEach(() => { _resetRateLimit(); _resetRolesCache(); _resetChasCache(); });

/* ---------- endpoints, CORS, read-only ---------- */
test('health and sources describe the connected registries without exposing secrets', async () => {
  const health = await call('/health', {env: {...ENV, ESANTE_API_KEY: KEY}});
  assert.equal(health.status, 200);
  assert.deepEqual(health.body.sources.map(s => [s.id, s.country, s.configured]),
    [['us-nppes', 'US', true], ['gb-nhs-ods', 'GB', true], ['fr-annuaire-sante', 'FR', true], ['co-reps', 'CO', true], ['mx-inegi', 'MX', false], ['sg-chas', 'SG', false]]);
  const sources = await call('/sources', {env: ENV});
  assert.equal(sources.body.sources.find(s => s.id === 'fr-annuaire-sante').configured, false);
  assert.equal(sources.body.sources.find(s => s.id === 'fr-annuaire-sante').requires_secret, 'ESANTE_API_KEY');
  assert.deepEqual(sources.body.sources.find(s => s.id === 'us-nppes').filters, ['name', 'city', 'region', 'postal_code', 'specialty']);
  const withKey = await call('/sources', {env: {...ENV, ESANTE_API_KEY: KEY}});
  assert.ok(!withKey.text.includes(KEY), 'secret value never returned');
});

test('CORS allows only FRONTEND_ORIGIN (comma-separated list supported)', async () => {
  const ok = await call('/health');
  assert.equal(ok.headers.get('access-control-allow-origin'), FRONTEND);
  assert.equal(ok.headers.get('vary'), 'Origin');
  const evil = await call('/health', {origin: 'https://evil.example'});
  assert.equal(evil.headers.get('access-control-allow-origin'), null);
  const multi = await call('/health', {origin: 'http://127.0.0.1:4173', env: {FRONTEND_ORIGIN: `${FRONTEND}, http://127.0.0.1:4173/`}});
  assert.equal(multi.headers.get('access-control-allow-origin'), 'http://127.0.0.1:4173');
  const none = await call('/health', {env: {}});
  assert.equal(none.headers.get('access-control-allow-origin'), null, 'no origin allowed when FRONTEND_ORIGIN is unset');
  const preflight = await worker.fetch(new Request('https://x.dev/search', {method: 'OPTIONS', headers: {Origin: FRONTEND, 'Access-Control-Request-Method': 'GET'}}), ENV, {});
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-methods'), 'GET, HEAD, OPTIONS');
});

test('the API is read-only and sends security headers', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    const r = await call('/search?country=GB&name=x', {method});
    assert.equal(r.status, 405, method);
    assert.equal(r.headers.get('allow'), 'GET, HEAD, OPTIONS');
  }
  const r = await call('/health');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.match(r.headers.get('content-security-policy'), /default-src 'none'/);
  assert.equal((await call('/nope')).status, 404);
});

test('rate limit: more than 60 requests per minute from one IP get 429 with Retry-After', async () => {
  for (let i = 0; i < 60; i++) assert.equal((await call('/health', {ip: '9.9.9.9'})).status, 200);
  const limited = await call('/health', {ip: '9.9.9.9'});
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers.get('retry-after')) > 0);
  assert.equal((await call('/health', {ip: '8.8.8.8'})).status, 200, 'other clients unaffected');
});

/* ---------- validation ---------- */
test('search validation: country, unknown parameters, lengths, characters, paging', async () => {
  const cases = [
    ['/search', /country/],
    ['/search?country=USA&name=x', /two-letter/],
    ['/search?country=US&name=mayo&foo=1', /Unsupported parameter: foo/],
    ['/search?country=US&name=a&name=b', /only be given once/],
    ['/search?country=US&name=' + 'x'.repeat(101), /at most 100/],
    ['/search?country=US&name=%3Cscript%3E', /unsupported characters/],
    ['/search?country=US&name=mayo&page=0', /page must be/],
    ['/search?country=US&name=mayo&per_page=51', /per_page must be/],
    ['/search?country=US&postal_code=%22%3B', /postal_code/]
  ];
  for (const [path, message] of cases) {
    const r = await call(path);
    assert.equal(r.status, 400, path);
    assert.match(r.body.error.message, message, path);
  }
  assert.equal(parseSearch(new URLSearchParams('country=gb&name=st%20mary*')).name, 'st mary', 'wildcards stripped');
});

test('country routing: supported countries map to their registry; others get a clear 404', async () => {
  const r = await call('/search?country=DE&name=klinik');
  assert.equal(r.status, 404);
  assert.equal(r.body.error.code, 'no_registry');
  assert.deepEqual(r.body.error.details.supported_countries, ['US', 'GB', 'FR', 'CO', 'MX', 'SG']);
  const mismatch = await call('/search?country=GB&source=us-nppes&name=x');
  assert.equal(mismatch.status, 400);
  const unknown = await call('/search?source=xx-none&name=x');
  assert.equal(unknown.status, 400);
});

test('filters a registry does not support are rejected, listing the supported ones', async () => {
  const r = await call('/search?country=GB&city=London');
  assert.equal(r.status, 400);
  assert.deepEqual(r.body.error.details.supported_filters, ['name', 'postal_code', 'specialty']);
});

/* ---------- United States: NPPES ---------- */
test('US NPPES: name, location and specialty map to NPPES parameters; records are standardized', async () => {
  const rows = [nppesOrg('1234567890', 'MAYO CLINIC'), nppesOrg('1234567891', 'MAYO CLINIC HEALTH SYSTEM'), nppesOrg('1234567892', 'MAYO EXTRA ROW')];
  const {fetchImpl, calls} = mockFetch([[u => u.hostname === 'npiregistry.cms.hhs.gov', {body: {result_count: 3, results: rows}}]]);
  const r = await call('/search?country=US&name=mayo&city=Rochester&region=mn&postal_code=55905&specialty=clinic&per_page=2&page=2', {fetchImpl});
  assert.equal(r.status, 200);
  const sent = calls[0].url.searchParams;
  assert.equal(sent.get('version'), '2.1');
  assert.equal(sent.get('enumeration_type'), 'NPI-2');
  assert.equal(sent.get('organization_name'), 'mayo*');
  assert.equal(sent.get('city'), 'Rochester');
  assert.equal(sent.get('state'), 'MN');
  assert.equal(sent.get('postal_code'), '55905*');
  assert.equal(sent.get('taxonomy_description'), 'clinic');
  assert.equal(sent.get('limit'), '3', 'one extra row to detect more pages');
  assert.equal(sent.get('skip'), '2');
  assert.equal(r.body.count, 2);
  assert.equal(r.body.has_more, true);
  const f = r.body.items[0];
  assert.equal(f.id, 'us-nppes:1234567890');
  assert.equal(f.name, 'Mayo Clinic');
  assert.equal(f.category, 'Clinic/Center, Multi-Specialty', 'primary taxonomy first');
  assert.deepEqual(f.address, {line1: '200 First St Sw', line2: null, city: 'Rochester', region: 'MN', postal_code: '55905-0001', country_code: 'US'});
  assert.equal(f.phone, '507-284-2511');
  assert.equal(f.source_url, 'https://npiregistry.cms.hhs.gov/provider-view/1234567890');
  assert.ok(!('latitude' in f) && !('longitude' in f) && !JSON.stringify(f).includes('44.02'), 'no coordinates exposed');
  assert.equal(r.headers.get('cache-control'), 'public, max-age=300');
});

test('US NPPES: state alone is refused before calling the registry; NPPES errors become 400', async () => {
  const {fetchImpl, calls} = mockFetch([[() => true, {body: {Errors: [{description: 'Field state requires additional search criteria'}]}}]]);
  const stateOnly = await call('/search?country=US&region=MA', {fetchImpl});
  assert.equal(stateOnly.status, 400);
  assert.equal(calls.length, 0);
  const badRegion = await call('/search?country=US&name=x&region=Mass', {fetchImpl});
  assert.equal(badRegion.status, 400);
  const rejected = await call('/search?country=US&specialty=zz', {fetchImpl});
  assert.equal(rejected.status, 400);
  assert.match(rejected.body.error.details, /additional search criteria/);
});

test('US NPPES: facility detail by NPI; invalid and individual NPIs are refused', async () => {
  const {fetchImpl} = mockFetch([
    [u => u.searchParams.get('number') === '1234567890', {body: {results: [nppesOrg('1234567890', 'MAYO CLINIC')]}}],
    [u => u.searchParams.get('number') === '1111111111', {body: {results: [{...nppesOrg('1111111111', 'DR X'), enumeration_type: 'NPI-1'}]}}],
    [() => true, {body: {results: []}}]
  ]);
  const ok = await call('/facilities/us-nppes/1234567890', {fetchImpl});
  assert.equal(ok.status, 200);
  assert.equal(ok.body.facility.name, 'Mayo Clinic');
  assert.equal((await call('/facilities/us-nppes/12345', {fetchImpl})).status, 400);
  assert.equal((await call('/facilities/us-nppes/1111111111', {fetchImpl})).status, 404, 'individual practitioners are not facilities');
  assert.equal((await call('/facilities/us-nppes/2222222222', {fetchImpl})).status, 404);
});

/* ---------- United Kingdom: NHS ODS ---------- */
test('GB NHS ODS: specialty maps to an ODS role, totals come from X-Total-Count, page 1 omits Offset', async () => {
  const {fetchImpl, calls} = mockFetch([
    [u => u.pathname.endsWith('/roles'), {body: ODS_ROLES}],
    [u => u.pathname.endsWith('/organisations'), u => ({body: {Organisations: [odsRow('FA001', "ST MARY'S PHARMACY"), odsRow('FA002', 'NHS PHARMACY')]}, headers: {'x-total-count': '93'}})]
  ]);
  const first = await call('/search?country=GB&name=pharm&postal_code=se1&specialty=pharmacy&per_page=2', {fetchImpl});
  assert.equal(first.status, 200);
  const sent = calls.find(c => c.url.pathname.endsWith('/organisations')).url.searchParams;
  assert.equal(sent.get('Name'), 'pharm');
  assert.equal(sent.get('PostCode'), 'SE1');
  assert.equal(sent.get('PrimaryRoleId'), 'RO182');
  assert.equal(sent.get('Status'), 'Active');
  assert.equal(sent.get('Offset'), null, 'ODS rejects Offset=0');
  assert.equal(first.body.total, 93);
  assert.equal(first.body.has_more, true);
  assert.deepEqual(first.body.applied_filters, {specialty: 'PHARMACY'});
  assert.equal(first.body.items[0].name, "St Mary's Pharmacy");
  assert.equal(first.body.items[1].name, 'NHS Pharmacy');
  await call('/search?country=GB&specialty=pharmacy&per_page=2&page=3', {fetchImpl});
  assert.equal(calls.at(-1).url.searchParams.get('Offset'), '4');
  const trust = await call('/search?country=GB&specialty=nhs%20trust', {fetchImpl});
  assert.equal(calls.at(-1).url.searchParams.get('PrimaryRoleId'), 'RO197', 'exact role name preferred over longer matches');
  assert.equal(trust.status, 200);
  const none = await call('/search?country=GB&specialty=astrology', {fetchImpl});
  assert.equal(none.status, 400);
});

test('GB NHS ODS: detail record includes address, phone, website and role names', async () => {
  const {fetchImpl} = mockFetch([
    [u => u.pathname.endsWith('/roles'), {body: ODS_ROLES}],
    [u => u.pathname.endsWith('/organisations/RJ1'), {body: {Organisation: {
      Name: "GUY'S AND ST THOMAS' NHS FOUNDATION TRUST", OrgId: {extension: 'RJ1'}, Status: 'Active', LastChangeDate: '2023-11-14',
      GeoLoc: {Location: {AddrLn1: "ST THOMAS' HOSPITAL", AddrLn2: 'WESTMINSTER BRIDGE ROAD', Town: 'LONDON', PostCode: 'SE1 7EH', Country: 'ENGLAND'}},
      Contacts: {Contact: [{type: 'tel', value: '020 7188 7188'}, {type: 'http', value: 'HTTPS://WWW.GUYSANDSTTHOMAS.NHS.UK/'}]},
      Roles: {Role: [{id: 'RO197', primaryRole: true, Status: 'Active'}, {id: 'RO177', Status: 'Active'}]}
    }}}],
    [u => u.pathname.includes('/organisations/'), {status: 404, body: {}}]
  ]);
  const r = await call('/facilities/gb-nhs-ods/rj1', {fetchImpl});
  assert.equal(r.status, 200);
  const f = r.body.facility;
  assert.equal(f.name, "Guy's And St Thomas' NHS Foundation Trust");
  assert.deepEqual(f.specialties, ['NHS Trust', 'Prescribing Cost Centre']);
  assert.equal(f.address.line1, "St Thomas' Hospital, Westminster Bridge Road");
  assert.equal(f.address.city, 'London');
  assert.equal(f.phone, '020 7188 7188');
  assert.equal(f.website, 'https://www.guysandstthomas.nhs.uk/');
  assert.equal((await call('/facilities/gb-nhs-ods/ZZ999', {fetchImpl})).status, 404);
  assert.equal((await call('/facilities/gb-nhs-ods/bad%20id!', {fetchImpl})).status, 400);
});

/* ---------- France: ANS Annuaire Santé (keyed) ---------- */
test('FR Annuaire Santé: needs the ESANTE_API_KEY secret; without it the API answers 503, not an upstream call', async () => {
  const {fetchImpl, calls} = mockFetch([[() => true, {body: {}}]]);
  const r = await call('/search?country=FR&name=chu', {fetchImpl});
  assert.equal(r.status, 503);
  assert.equal(r.body.error.code, 'source_not_configured');
  assert.match(r.body.error.message, /ESANTE_API_KEY/);
  assert.equal(calls.length, 0);
});

test('FR Annuaire Santé: FHIR search with the key header, cursor paging, standardized records', async () => {
  const next = 'https://gateway.api.esante.gouv.fr/fhir/v2/Organization?_getpages=abc123&_getpagesoffset=2&_count=2';
  const {fetchImpl, calls} = mockFetch([[u => u.hostname === 'gateway.api.esante.gouv.fr', u => ({body: {
    resourceType: 'Bundle', total: 7,
    link: u.searchParams.get('_getpages') ? [] : [{relation: 'next', url: next}],
    entry: [{resource: fhirOrg('ORG-1', 'CHU DE BORDEAUX')}, {resource: fhirOrg('ORG-2', 'CLINIQUE TEST')}]
  }})]]);
  const env = {...ENV, ESANTE_API_KEY: KEY};
  const r = await call('/search?country=FR&name=chu&city=Bordeaux&postal_code=33000&per_page=2', {env, fetchImpl});
  assert.equal(r.status, 200);
  const first = calls[0];
  assert.equal(first.url.pathname, '/fhir/v2/Organization');
  assert.equal(first.url.searchParams.get('name:contains'), 'chu');
  assert.equal(first.url.searchParams.get('address-city'), 'Bordeaux');
  assert.equal(first.url.searchParams.get('address-postalcode'), '33000');
  assert.equal(first.url.searchParams.get('_count'), '2');
  assert.equal(first.headers['ESANTE-API-KEY'], KEY, 'key sent only in the registry request header');
  assert.ok(!r.text.includes(KEY), 'key never in the response');
  assert.equal(r.body.total, 7);
  assert.equal(r.body.page, null);
  assert.equal(r.body.has_more, true);
  const f = r.body.items[0];
  assert.equal(f.name, 'CHU De Bordeaux');
  assert.equal(f.category, 'Centre Hospitalier Universitaire (C.H.U.)');
  assert.equal(f.address.city, 'Bordeaux');
  assert.equal(f.website, 'https://www.example-chu.fr/');
  assert.deepEqual(f.identifiers[0], {system: 'FINESS', value: '1ORG-1'});
  const page2 = await call(`/search?country=FR&cursor=${r.body.next_cursor}`, {env, fetchImpl});
  assert.equal(page2.status, 200);
  assert.equal(calls.at(-1).url.href, next);
  assert.equal(page2.body.has_more, false);
  assert.equal((await call('/search?country=FR&name=x&page=2', {env, fetchImpl})).status, 400, 'cursor paging only');
  assert.equal((await call('/search?country=FR&specialty=cardio', {env, fetchImpl})).status, 400, 'specialty unsupported');
});

test('FR cursors cannot be used to reach any other host or path', () => {
  assert.equal(encodeCursor('https://evil.example/fhir/v2/Organization?x=1'), null);
  const evil = btoa('//evil.example/x').replace(/=+$/, '');
  assert.throws(() => decodeCursor(evil), /Invalid cursor/);
  assert.throws(() => decodeCursor(btoa('/admin').replace(/=+$/, '')), /Invalid cursor/);
  const round = decodeCursor(encodeCursor('https://gateway.api.esante.gouv.fr/fhir/v2/Organization?_getpages=a'));
  assert.equal(round.href, 'https://gateway.api.esante.gouv.fr/fhir/v2/Organization?_getpages=a');
});

/* ---------- upstream failures ---------- */
test('registry failures map to safe errors and never leak the key', async () => {
  const env = {...ENV, ESANTE_API_KEY: KEY};
  const logs = [];
  const original = console.warn;
  console.warn = (...args) => logs.push(args.join(' '));
  try {
    let r = await call('/search?country=FR&name=x', {env, fetchImpl: mockFetch([[() => true, {status: 401, body: {message: `bad key ${KEY}`}}]]).fetchImpl});
    assert.equal(r.status, 503);
    assert.equal(r.body.error.code, 'source_credentials_rejected');
    assert.ok(!r.text.includes(KEY));
    r = await call('/search?country=GB&name=x', {fetchImpl: mockFetch([[() => true, {status: 500, body: {}}]]).fetchImpl});
    assert.equal(r.status, 502);
    r = await call('/search?country=GB&name=x', {fetchImpl: mockFetch([[() => true, {status: 429, body: {}}]]).fetchImpl});
    assert.equal(r.status, 503);
    const hang = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), {name: 'AbortError'}))));
    r = await call('/search?country=GB&name=x', {fetchImpl: hang, timeoutMs: 50});
    assert.equal(r.status, 504);
    r = await call('/search?country=GB&name=x', {fetchImpl: async () => new Response('not json', {status: 200})});
    assert.equal(r.status, 502);
  } finally {
    console.warn = original;
  }
  assert.ok(logs.every(line => !line.includes(KEY)), 'key never logged');
});

test('names are made readable without mangling possessives or acronyms', () => {
  assert.equal(readable("GUY'S AND ST THOMAS' NHS FOUNDATION TRUST"), "Guy's And St Thomas' NHS Foundation Trust");
  assert.equal(readable("O'BRIEN CLINIC"), "O'Brien Clinic");
  assert.equal(readable('ATRIUS HEALTH, INC.'), 'Atrius Health, Inc.');
  assert.equal(readable('Already Mixed Case'), 'Already Mixed Case');
});

test('worker source contains no hard-coded secrets, scrapers, schedules or storage bindings', async () => {
  const {readFile, readdir} = await import('node:fs/promises');
  const files = ['worker/wrangler.toml', ...(await readdir('worker/src')).filter(f => f.endsWith('.js')).map(f => `worker/src/${f}`),
    ...(await readdir('worker/src/sources')).map(f => `worker/src/sources/${f}`)];
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    assert.doesNotMatch(text, /\bscheduled\s*\(|\[triggers\]|crons\s*=|kv_namespaces|d1_databases|r2_buckets|postgres(ql)?:\/\//i, file);
    assert.doesNotMatch(text, /ESANTE_API_KEY\s*=\s*["'][^"']/, file);
  }
});


/* ---------- Colombia: Socrata REPS source ---------- */
test('CO REPS: queries official Socrata registry with escaped filtering and correct site fields', async () => {
  const site = {
    codigoprestador: '9100100019',
    codigohabilitacionsede: '910010001901',
    nombresede: 'E.S.E. HOSPITAL SAN RAFAEL',
    claseprestador: 'Instituciones Prestadoras de Servicios de Salud - IPS',
    municipiosede: '91001',
    municipiosededesc: 'LETICIA',
    departamentodededesc: 'Amazonas',
    direcci_nsede: 'CRA 10 # 13-78',
    email_sede: 'calidad@example.co',
    t_lefonosede: '3203016139',
    fecha_corte_reps: 'Fecha corte REPS: Mar 12 2026'
  };
  const {fetchImpl, calls} = mockFetch([
    [u => u.hostname === 'www.datos.gov.co', {body: [site, {...site, codigohabilitacionsede: '910010001902'}]}]
  ]);
  const r = await call('/search?country=CO&name=HOSPITAL&city=Leticia&region=91&specialty=IPS&per_page=1&page=2', {fetchImpl});
  assert.equal(r.status, 200);
  const sent = calls[0].url;
  assert.equal(sent.hostname, 'www.datos.gov.co');
  assert.equal(sent.searchParams.get('$order'), 'codigohabilitacionsede ASC');
  assert.equal(sent.searchParams.get('$limit'), '2');
  assert.equal(sent.searchParams.get('$offset'), '1');
  assert.match(sent.searchParams.get('$where'), /municipiosede like '91%'/);
  assert.match(sent.searchParams.get('$where'), /upper\(nombresede\)/);
  assert.match(sent.searchParams.get('$where'), /upper\(municipiosededesc\)/);
  assert.match(sent.searchParams.get('$where'), /upper\(claseprestador\)/);
  assert.equal(r.body.count, 1);
  assert.equal(r.body.has_more, true);
  assert.equal(r.body.items[0].id, 'co-reps:910010001901');
  assert.equal(r.body.items[0].address.region, 'Amazonas');
  assert.equal(r.body.items[0].address.country_code, 'CO');
  assert.equal(r.body.items[0].email, 'calidad@example.co');
  assert.equal(r.body.items[0].phone, '3203016139');
  const one = await call('/facilities/co-reps/910010001901', {fetchImpl});
  assert.equal(one.status, 200);
  assert.equal(one.body.facility.name, 'E.S.E. Hospital San Rafael');
  assert.equal(calls.at(-1).url.searchParams.get('codigohabilitacionsede'), '910010001901');
  assert.equal((await call('/search?country=CO&region=Amazonas', {fetchImpl})).status, 400);
  assert.equal((await call('/facilities/co-reps/%3Cscript%3E', {fetchImpl})).status, 400);
});
test('CO REPS: apostrophe in a name is escaped before reaching SoQL', async () => {
  const {fetchImpl, calls} = mockFetch([[() => true, {body: []}]]);
  await call('/search?country=CO&name=O%27Brien', {fetchImpl});
  assert.match(calls[0].url.searchParams.get('$where'), /O''BRIEN/);
});

/* ---------- Mexico: official token-based DENUE API ---------- */
test('MX INEGI: unavailable without the official token, configured when bound', async () => {
  const missing = await call('/search?country=MX&name=HOSPITAL');
  assert.equal(missing.status, 503);
  assert.equal(missing.body.error.code, 'source_not_configured');
  const {fetchImpl, calls} = mockFetch([[() => true, {body: []}]]);
  const supplied = await call('/sources', {env: {...ENV, INEGI_DENUE_TOKEN: 'fixture-denue-token'}});
  const mexico = supplied.body.sources.find(s => s.id === 'mx-inegi');
  assert.equal(mexico.configured, true);
  assert.equal(mexico.requires_secret, 'INEGI_DENUE_TOKEN');
  assert.deepEqual(mexico.filters, ['name', 'region', 'specialty']);
  assert.ok(!supplied.text.includes('fixture-denue-token'));
  assert.equal((await call('/search?country=MX&city=Centro', {env: {...ENV, INEGI_DENUE_TOKEN: 'fixture-denue-token'}, fetchImpl})).status, 400);
  assert.equal(calls.length, 0);
});

test('MX INEGI: official BuscarAreaAct uses healthcare sector 62 and paginates with 1-based records', async () => {
  const site = {
    Id: '3963932', CLEE: '27004622111000001000000000U2',
    Nombre: 'HOSPITAL DEL SURESTE', Clase_actividad: 'Hospitales generales del sector privado',
    Tipo_vialidad: 'AVENIDA', Calle: 'GREGORIO MENDEZ', Num_Exterior: '104',
    Colonia: 'CENTRO', CP: '86070', Ubicacion: 'VILLAHERMOSA, Centro, TABASCO',
    Telefono: '9931111111', Correo_e: 'hospital@example.mx', Sitio_internet: 'www.example.mx',
    SUBSECTOR_ACTIVIDAD_ID: '622', SECTOR_ACTIVIDAD_ID: '62', CLASE_ACTIVIDAD_ID: '622111'
  };
  const {fetchImpl, calls} = mockFetch([
    [u => u.hostname === 'www.inegi.org.mx', {body: [site, {...site, Id: '3963933'}]}]
  ]);
  const env = {...ENV, INEGI_DENUE_TOKEN: 'fixture-denue-token'};
  const r = await call('/search?country=MX&region=27&name=HOSPITAL&specialty=Hospitales&per_page=1&page=2', {env, fetchImpl});
  assert.equal(r.status, 200);
  const sent = calls[0].url;
  assert.equal(sent.hostname, 'www.inegi.org.mx');
  assert.equal(sent.protocol, 'https:');
  assert.equal(sent.pathname, '/app/api/denue/v1/consulta/BuscarAreaAct/27/0/0/0/0/62/622/0/0/HOSPITAL/2/3/0/fixture-denue-token');
  assert.equal(r.body.count, 1);
  assert.equal(r.body.has_more, true);
  assert.equal(r.body.items[0].id, 'mx-inegi:3963932');
  assert.equal(r.body.items[0].address.country_code, 'MX');
  assert.equal(r.body.items[0].address.region, 'Tabasco');
  assert.equal(r.body.items[0].address.city, 'Villahermosa');
  assert.equal(r.body.items[0].website, 'https://www.example.mx/');
  assert.equal(r.body.items[0].email, 'hospital@example.mx');
  assert.ok(!('latitude' in r.body.items[0]) && !('longitude' in r.body.items[0]));
  assert.ok(!r.text.includes('fixture-denue-token'));
  const detail = await call('/facilities/mx-inegi/3963932', {env, fetchImpl});
  assert.equal(detail.status, 200);
  assert.equal(detail.body.facility.id, 'mx-inegi:3963932');
  assert.equal(calls.at(-1).url.pathname, '/app/api/denue/v1/consulta/BuscarAreaAct/00/0/0/0/0/62/0/0/0/0/1/2/3963932/fixture-denue-token');
});

test('MX INEGI: empty upstream results are an empty search, not a server error', async () => {
  const env = {...ENV, INEGI_DENUE_TOKEN: 'fixture-denue-token'};
  const {fetchImpl} = mockFetch([[() => true, {body: {Message: 'No se encontraron registros'}}]]);
  const result = await call('/search?country=MX&region=27&name=ZZZXQYNOTEXIST', {env, fetchImpl});
  assert.equal(result.status, 200);
  assert.equal(result.body.count, 0);
  assert.equal(result.body.has_more, false);
  assert.deepEqual(result.body.items, []);
});

test('MX INEGI: restricts unknown specialties, state codes and unavailable location filters', async () => {
  const env = {...ENV, INEGI_DENUE_TOKEN: 'fixture-denue-token'};
  const {fetchImpl, calls} = mockFetch([[() => true, {body: []}]]);
  assert.equal((await call('/search?country=MX&region=33', {env, fetchImpl})).status, 400);
  assert.equal((await call('/search?country=MX&specialty=astrology', {env, fetchImpl})).status, 400);
  assert.equal((await call('/search?country=MX&postal_code=86070', {env, fetchImpl})).status, 400);
  assert.equal((await call('/facilities/mx-inegi/ABC', {env, fetchImpl})).status, 400);
  assert.equal(calls.length, 0);
});


/* ---------- Singapore MOH CHAS Clinics (public dataset with API key) ---------- */
function chasRecord(id, name = 'Acumed Medical Group', postal = '629117') {
  const fields = {
    HCI_CODE:id,HCI_NAME:name,LICENCE_TYPE:'MC',HCI_TEL:'68615755',POSTAL_CD:postal,
    BLK_HSE_NO:'1',FLOOR_NO:'01',UNIT_NO:'23',STREET_NAME:'JOO KOON CIRCLE',
    BUILDING_NAME:'FAIRPRICE HUB',CLINIC_PROGRAMME_CODE:'CDMP,CHAS'
  };
  const desc='<center><table>'+Object.entries(fields).map(([k,v])=>'<tr><th>'+k+'</th><td>'+v+'</td></tr>').join('')+'</table></center>';
  return {type:'Feature',properties:{Name:'kml_'+id,Description:desc},geometry:{type:'Point',coordinates:[103.678,1.325]}};
}

test('SG CHAS: dataset polling uses API key only upstream and never returns coordinates', async () => {
  const env={...ENV,DATA_GOV_SG_API_KEY:'fixture-singapore-key'};
  const {fetchImpl,calls}=mockFetch([
    [u=>u.hostname==='api-open.data.gov.sg',{body:{code:0,data:{url:'https://s3.ap-southeast-1.amazonaws.com/blobs.data.gov.sg/d_548c33ea2d99e29ec63a7cc9edcccedc.geojson?X-Amz-Date=20261026T080000Z'},errorMsg:''}}],
    [u=>u.hostname==='s3.ap-southeast-1.amazonaws.com',{body:{type:'FeatureCollection',features:[chasRecord('15M0211'),chasRecord('20M0123','Test Hospital','123456')]}}]
  ]);
  const results=await call('/search?country=SG&name=Acumed&per_page=1',{env,fetchImpl});
  assert.equal(results.status,200);
  assert.equal(results.body.source,'sg-chas');
  assert.equal(results.body.count,1);
  assert.equal(results.body.items[0].id,'sg-chas:15M0211');
  assert.equal(results.body.items[0].name,'Acumed Medical Group');
  assert.equal(results.body.items[0].address.postal_code,'629117');
  assert.equal(results.body.items[0].address.country_code,'SG');
  assert.equal(results.body.items[0].phone,'68615755');
  assert.equal(results.body.items[0].address.line1,'1 Joo Koon Circle');
  assert.ok(!results.text.includes('fixture-singapore-key'));
  assert.ok(!('latitude' in results.body.items[0])&&!('longitude' in results.body.items[0]));
  assert.equal(calls.length,2);
  assert.equal(calls[0].headers['x-api-key'],'fixture-singapore-key');
  assert.ok(!('x-api-key' in calls[1].headers));
  const single=await call('/facilities/sg-chas/15M0211',{env,fetchImpl});
  assert.equal(single.status,200);
  assert.equal(single.body.facility.name,'Acumed Medical Group');
  const filtered=await call('/search?country=SG&postal_code=123456',{env,fetchImpl});
  assert.equal(filtered.body.count,1);
  assert.equal(filtered.body.items[0].id,'sg-chas:20M0123');
});
test('SG CHAS: unknown source and malformed signed URL fail closed',async()=>{
  const env={...ENV,DATA_GOV_SG_API_KEY:'fixture-singapore-key'};
  const {fetchImpl}=mockFetch([[()=>true,{body:{code:0,data:{url:'https://attacker.example/swap.geojson'}}}]]);
  const r=await call('/search?country=SG&name=Acumed',{env,fetchImpl});
  assert.equal(r.status,502);
  assert.equal((await call('/search?country=SG&region=USA',{env,fetchImpl})).status,400);
  const absent=await call('/search?country=SG&name=Acumed',{env:{...ENV},fetchImpl});
  assert.equal(absent.status,503);
});
