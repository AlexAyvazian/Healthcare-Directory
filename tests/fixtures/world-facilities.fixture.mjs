/* TEST FIXTURES ONLY — synthetic records used by browser tests through request interception.
 * They are never written to Neon and are not real healthcare facilities. */
const categories = ['hospital', 'clinic', 'pharmacy'];

function make(region, code, count) {
  return Array.from({length: count}, (_, i) => ({
    id: (code === 'CA-BC' ? 10000 : 20000) + i,
    country_iso3: 'CAN',
    country_iso2: 'CA',
    admin_path: [code],
    admin_names: [region],
    name: `FIXTURE ${region} Test Facility ${String(i + 1).padStart(2, '0')}`,
    category: categories[i % categories.length],
    address: `${100 + i} Fixture Street`,
    city: i % 2 ? 'Fixture City' : 'Sample Town',
    postal_code: 'T0T 0T0',
    phone: '+1 555 0100',
    email: 'fixture@example.invalid',
    website: 'https://example.invalid/',
    source_name: 'Automated test fixture (not real data)',
    source_url: null,
    source_retrieved_at: null
  }));
}

export const FIXTURES = {
  'CA-BC': make('British Columbia', 'CA-BC', 75),
  'CA-AB': make('Alberta', 'CA-AB', 3)
};

/* Minimal PostgREST emulation for the fixture rows (filters used by world-data.js). */
export function respond(urlString) {
  const url = new URL(urlString);
  const and = url.searchParams.get('and') || '';
  const code = Object.keys(FIXTURES).find(c => and.includes(`{"${c}"}`));
  let rows = code ? FIXTURES[code] : [];
  const category = (url.searchParams.get('category') || '').replace(/^eq\./, '');
  if (category) rows = rows.filter(r => r.category === category);
  const search = /name\.ilike\."\*([^*]*)\*"/.exec(and)?.[1];
  if (search) rows = rows.filter(r => (r.name + ' ' + r.city).toLowerCase().includes(search.toLowerCase()));
  const limit = Number(url.searchParams.get('limit') || 51), offset = Number(url.searchParams.get('offset') || 0);
  const page = rows.slice(offset, offset + limit);
  return {
    status: 200,
    headers: {'content-type': 'application/json', 'content-range': `${page.length ? offset + '-' + (offset + page.length - 1) : '*'}/${rows.length}`, 'access-control-allow-origin': '*', 'access-control-expose-headers': 'Content-Range'},
    body: JSON.stringify(page)
  };
}
