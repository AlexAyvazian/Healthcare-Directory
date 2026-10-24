/* Public, read-only Neon Data API. This URL is NOT a database password or a management key. */
export const DATA_API_URL = 'https://ep-bitter-breeze-b4mo7ule.apirest.c-6.us-east-2.aws.neon.tech/neondb/rest/v1';
const PUBLIC_COLUMNS = 'id,name,category,county_fips,address,city,state,postal_code,phone,website,latitude,longitude,source_name';

async function readArray(url, fetchImpl) {
  const response = await fetchImpl(url.toString(), {
    method: 'GET',
    headers: {'Accept': 'application/json', 'Prefer': 'count=exact'},
    cache: 'no-store'
  });
  if (!response.ok) throw new Error('Neon Data API request failed (' + response.status + ').');
  const data = await response.json();
  if (!Array.isArray(data)) throw new Error('Unexpected Neon Data API response.');
  return {response, data};
}

export async function listCountyFacilities(countyFips, {category='',page=1,perPage=100,fetchImpl=fetch}={}) {
  if (!/^\d{5}$/.test(countyFips)) throw new Error('Invalid county FIPS.');
  if (!Number.isSafeInteger(page) || page < 1) throw new Error('Invalid page.');
  if (!Number.isSafeInteger(perPage) || perPage < 1 || perPage > 249) throw new Error('Invalid page size.');
  const url = new URL(DATA_API_URL + '/healthcare_facilities');
  url.searchParams.set('select', PUBLIC_COLUMNS);
  url.searchParams.set('county_fips', 'eq.' + countyFips);
  if (category) url.searchParams.set('category','eq.' + category);
  url.searchParams.set('order','name.asc,id.asc');
  url.searchParams.set('limit', String(perPage + 1));
  url.searchParams.set('offset', String((page - 1) * perPage));
  const {response,data} = await readArray(url,fetchImpl);
  const header = response.headers?.get?.('content-range') || '';
  const match = /\/(\d+)$/.exec(header);
  const total = match ? Number(match[1]) : null;
  const facilities = data.slice(0,perPage);
  return {
    county_fips: countyFips,
    facilities,
    page,
    total,
    has_more: data.length > perPage || (total !== null && page * perPage < total)
  };
}

export async function listCategories({fetchImpl=fetch}={}) {
  const url = new URL(DATA_API_URL + '/facility_category_counts');
  url.searchParams.set('select','category,total');
  url.searchParams.set('order','category.asc');
  const {data} = await readArray(url,fetchImpl);
  return {categories:data};
}
