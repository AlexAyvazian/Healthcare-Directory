/* Read-only client for the International Directory's Neon Data API (WORLD_HEALTHCARE_DIRECTORY).
 * Only GET requests against the public `directory` schema; the anonymous JWT comes from the
 * branch's public Neon Auth endpoint and maps to the SELECT-only `anonymous` role. */
import {WORLD_DATA_API_URL, WORLD_AUTH_URL} from './world-config.js';

/* Published fields only: never `search_document`, coordinates, metadata, or private columns. */
export const PUBLIC_COLUMNS = 'id,country_iso3,country_iso2,admin_path,admin_names,name,category,address,city,postal_code,phone,email,website,source_name,source_url,source_retrieved_at';
export const PAGE_SIZE = 50; // the Data API caps responses at 101 rows

let token = null;
export function resetTokenCache() { token = null; }

async function anonymousToken(fetchImpl, force = false) {
  if (!force && token && token.expires - 60_000 > Date.now()) return token.value;
  const response = await fetchImpl(WORLD_AUTH_URL + '/token/anonymous', {method: 'GET', headers: {Accept: 'application/json'}, credentials: 'omit', cache: 'no-store'});
  if (!response.ok) throw new Error('Could not open a read-only directory session (' + response.status + ').');
  const body = await response.json();
  if (typeof body?.token !== 'string' || body.token.split('.').length !== 3) throw new Error('Unexpected directory session response.');
  let expires = Date.now() + 10 * 60_000;
  try {
    const claims = JSON.parse(atob(body.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (Number.isFinite(claims.exp)) expires = claims.exp * 1000;
  } catch { /* use the conservative default */ }
  token = {value: body.token, expires};
  return token.value;
}

async function readArray(url, fetchImpl, signal) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const bearer = await anonymousToken(fetchImpl, attempt > 0);
    const response = await fetchImpl(url.toString(), {
      method: 'GET',
      headers: {Accept: 'application/json', Prefer: 'count=exact', Authorization: 'Bearer ' + bearer},
      credentials: 'omit',
      cache: 'no-store',
      signal
    });
    if (response.status === 401 && attempt === 0) continue; // expired session: refresh once
    if (response.status === 416) return {response, data: []}; // page beyond the last record
    if (!response.ok) throw new Error('Directory request failed (' + response.status + ').');
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error('Unexpected directory response.');
    return {response, data};
  }
  throw new Error('Directory session was rejected.');
}

/* PostgREST logic-tree values are double-quoted; quotes/backslashes are stripped from user text. */
const quote = value => '"' + String(value).replace(/["\\]/g, '') + '"';
const arrayLiteral = value => '{' + quote(value) + '}';
export function cleanSearch(text) {
  return String(text || '').replace(/[%_*,()"\\:{}]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

/* Region filter: a facility belongs to a region when its admin_path holds one of the region's
 * codes (ISO 3166-2 or geoBoundaries shapeID), or when admin_names holds the region's name
 * together with every ancestor name (names alone are ambiguous between levels). */
export function regionCondition(region) {
  if (!region) return null;
  const byCode = (region.codes || []).map(code => `admin_path.cs.${arrayLiteral(code)}`);
  const names = [...(region.ancestors || []), region.name].filter(Boolean);
  const byName = names.length === 1 ? `admin_names.cs.${arrayLiteral(names[0])}` : `and(${names.map(n => `admin_names.cs.${arrayLiteral(n)}`).join(',')})`;
  return `or(${[...byCode, byName].join(',')})`;
}

export function buildFacilityQuery({country, region = null, category = '', search = '', page = 1, perPage = PAGE_SIZE}) {
  if (!/^[A-Z]{3}$/.test(country || '')) throw new Error('Invalid country code.');
  if (!Number.isSafeInteger(page) || page < 1) throw new Error('Invalid page.');
  if (!Number.isSafeInteger(perPage) || perPage < 1 || perPage > 100) throw new Error('Invalid page size.');
  const url = new URL(WORLD_DATA_API_URL + '/facilities');
  url.searchParams.set('select', PUBLIC_COLUMNS);
  url.searchParams.set('country_iso3', 'eq.' + country);
  if (category) url.searchParams.set('category', 'eq.' + category);
  const conditions = [];
  const regionFilter = regionCondition(region);
  if (regionFilter) conditions.push(regionFilter);
  const term = cleanSearch(search);
  if (term) conditions.push(`or(name.ilike.${quote('*' + term + '*')},city.ilike.${quote('*' + term + '*')})`);
  if (conditions.length) url.searchParams.set('and', '(' + conditions.join(',') + ')');
  url.searchParams.set('order', 'name.asc,id.asc');
  url.searchParams.set('limit', String(perPage + 1));
  url.searchParams.set('offset', String((page - 1) * perPage));
  return url;
}

export async function listFacilities(options, {fetchImpl = fetch, signal} = {}) {
  const page = options.page || 1, perPage = options.perPage || PAGE_SIZE;
  const {response, data} = await readArray(buildFacilityQuery({...options, page, perPage}), fetchImpl, signal);
  const match = /\/(\d+)$/.exec(response.headers?.get?.('content-range') || '');
  const total = match ? Number(match[1]) : null;
  return {
    facilities: data.slice(0, perPage),
    page,
    total,
    has_more: data.length > perPage || (total !== null && page * perPage < total)
  };
}

export async function listCategories(country, {fetchImpl = fetch, signal} = {}) {
  if (!/^[A-Z]{3}$/.test(country || '')) throw new Error('Invalid country code.');
  const url = new URL(WORLD_DATA_API_URL + '/category_counts');
  url.searchParams.set('select', 'category,total');
  url.searchParams.set('country_iso3', 'eq.' + country);
  url.searchParams.set('order', 'category.asc');
  const {data} = await readArray(url, fetchImpl, signal);
  return data.filter(row => typeof row?.category === 'string');
}
