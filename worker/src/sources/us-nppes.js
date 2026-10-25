/* United States — CMS National Plan and Provider Enumeration System (NPPES) NPI Registry API v2.1.
 * Public, keyless. Organizations only (enumeration type NPI-2).
 * Docs: https://npiregistry.cms.hhs.gov/api-page */
import {fetchJson, invalid, notFound} from '../http.js';
import {facility} from '../facility.js';

const BASE = 'https://npiregistry.cms.hhs.gov/api/';
const MAX_SKIP = 1000; // NPPES rejects skip values above 1000

function toFacility(r) {
  const addresses = r.addresses || [];
  const location = addresses.find(a => a.address_purpose === 'LOCATION') || addresses[0] || {};
  const taxonomies = (r.taxonomies || []).slice().sort((a, b) => Number(b.primary) - Number(a.primary));
  const zip = String(location.postal_code || '');
  return facility({
    source: 'us-nppes',
    id: r.number,
    name: r.basic?.organization_name,
    specialties: taxonomies.map(t => t.desc),
    status: r.basic?.status === 'A' ? 'active' : r.basic?.status === 'D' ? 'deactivated' : r.basic?.status,
    line1: location.address_1,
    line2: location.address_2,
    city: location.city,
    region: location.state,
    postalCode: zip.length === 9 ? `${zip.slice(0, 5)}-${zip.slice(5)}` : zip,
    countryCode: location.country_code || 'US',
    phone: location.telephone_number,
    identifiers: [{system: 'NPI', value: r.number}],
    updatedAt: r.basic?.last_updated,
    sourceUrl: `https://npiregistry.cms.hhs.gov/provider-view/${r.number}`
  });
}

function errorsOf(body) {
  const errors = body?.Errors;
  return Array.isArray(errors) && errors.length ? errors.map(e => e.description).filter(Boolean).join('; ') : null;
}

export const usNppes = {
  id: 'us-nppes',
  name: 'NPPES NPI Registry',
  authority: 'U.S. Centers for Medicare & Medicaid Services (CMS)',
  homepage: 'https://npiregistry.cms.hhs.gov/',
  country: 'US',
  secret: null,
  filters: ['name', 'city', 'region', 'postal_code', 'specialty'],
  notes: 'Name matches the start of the organization name. City or state alone is not enough; add a name, postal code, or specialty.',
  maxPerPage: 50,
  idPattern: /^\d{10}$/,

  validate(q) {
    if (q.region && !/^[A-Z]{2}$/.test(q.region)) throw invalid('For the United States, region must be a two-letter state code (e.g. MA).');
    if (!q.name && !q.postal_code && !q.specialty) throw invalid('Add a name, postal code, or specialty: the NPPES registry does not search by city or state alone.');
    if ((q.page - 1) * q.per_page > MAX_SKIP) throw invalid(`The NPPES registry only pages through the first ${MAX_SKIP + q.per_page} results; refine the search.`);
  },

  async search(q, ctx) {
    const url = new URL(BASE);
    url.searchParams.set('version', '2.1');
    url.searchParams.set('enumeration_type', 'NPI-2');
    if (q.name) url.searchParams.set('organization_name', q.name.length >= 2 ? `${q.name}*` : q.name);
    if (q.city) url.searchParams.set('city', q.city);
    if (q.region) url.searchParams.set('state', q.region);
    if (q.postal_code) url.searchParams.set('postal_code', `${q.postal_code.replace(/[\s-]/g, '')}*`);
    if (q.specialty) url.searchParams.set('taxonomy_description', q.specialty);
    url.searchParams.set('limit', String(q.per_page + 1)); // one extra row reveals whether more exist
    url.searchParams.set('skip', String((q.page - 1) * q.per_page));
    const {body} = await fetchJson(url, ctx);
    const error = errorsOf(body);
    if (error) throw invalid('The NPPES registry rejected these search criteria.', error);
    const rows = Array.isArray(body?.results) ? body.results : [];
    return {items: rows.slice(0, q.per_page).map(toFacility), total: null, hasMore: rows.length > q.per_page};
  },

  async get(id, ctx) {
    const url = new URL(BASE);
    url.searchParams.set('version', '2.1');
    url.searchParams.set('number', id);
    const {body} = await fetchJson(url, ctx);
    const record = body?.results?.[0];
    if (!record || record.enumeration_type !== 'NPI-2') throw notFound('No organization with this NPI.');
    return toFacility(record);
  }
};
