/* Client for the national healthcare registry API (Cloudflare Worker `healthcare-directory-api`).
 * Read-only HTTPS GET requests; no credentials are sent or held by the browser — registry API keys
 * live only in Cloudflare Worker Secrets. This complements, and never replaces, the Neon directory. */
import {REGISTRY_API_URL} from './world-config.js';

let sourcesPromise = null;

/* Registries that are connected and configured, keyed by ISO 3166-1 alpha-2 country code. */
export function registrySources({fetchImpl = fetch} = {}) {
  if (!sourcesPromise) {
    sourcesPromise = (async () => {
      const response = await fetchImpl(REGISTRY_API_URL + '/sources', {headers: {Accept: 'application/json'}, credentials: 'omit'});
      if (!response.ok) throw new Error('Registry API unavailable (' + response.status + ').');
      const body = await response.json();
      return new Map((body.sources || []).filter(s => s.configured).map(s => [s.country, s]));
    })();
    sourcesPromise.catch(() => { sourcesPromise = null; }); // retry on a later call
  }
  return sourcesPromise;
}

export async function searchRegistry({country, name = '', page = 1, cursor = null, perPage = 20}, {signal, fetchImpl = fetch} = {}) {
  const url = new URL(REGISTRY_API_URL + '/search');
  url.searchParams.set('country', country);
  const term = String(name).replace(/[^\p{L}\p{M}\p{N} .,'’&()/-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
  if (term) url.searchParams.set('name', term);
  if (cursor) url.searchParams.set('cursor', cursor);
  else if (page > 1) url.searchParams.set('page', String(page));
  url.searchParams.set('per_page', String(perPage));
  const response = await fetchImpl(url.toString(), {headers: {Accept: 'application/json'}, credentials: 'omit', signal});
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(body?.error?.message || 'Registry search failed (' + response.status + ').');
    error.status = response.status;
    throw error;
  }
  return body;
}

/* Registry record → the shape the sidebar cards and record drawer already render. */
export function toCardItem(record, sourceName, countryIso3) {
  return {
    id: record.id,
    name: record.name,
    category: record.category,
    address: [record.address?.line1, record.address?.line2].filter(Boolean).join(', ') || null,
    city: record.address?.city || null,
    postal_code: record.address?.postal_code || null,
    phone: record.phone,
    email: record.email,
    website: record.website,
    source_name: sourceName,
    source_url: record.source_url,
    country_iso3: countryIso3,
    admin_names: record.address?.region && !/^[A-Z]+$/.test(record.address.region) ? [record.address.region] : []
  };
}
