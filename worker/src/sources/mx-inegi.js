/* Mexico — INEGI's official token-based DENUE API.
 * Browser-facing directory remains read-only and does not expose individual coordinates.
 * https://www.inegi.org.mx/servicios/api-denue/
 * Uses BuscarAreaAct with sector 62 (healthcare and social assistance) for both
 * searches and record details. INEGI_DENUE_TOKEN stays in the Cloudflare Worker. */
import {ApiError, fetchJson, invalid, notFound} from '../http.js';
import {facility, readable} from '../facility.js';

const ROOT = 'https://www.inegi.org.mx/app/api/denue/v1/consulta';
const HOMEPAGE = 'https://www.inegi.org.mx/servicios/api-denue/';
const ID = /^[0-9]{1,15}$/;

/* Restrict specialties to INEGI healthcare subsectors rather than returning unfiltered
 * businesses or silently applying an incomplete client-side filter. */
const SUBSECTORS = new Map([
  ['621', '621'], ['ambulatory', '621'], ['outpatient', '621'], ['consultorios', '621'],
  ['622', '622'], ['hospital', '622'], ['hospitals', '622'], ['hospitales', '622'],
  ['623', '623'], ['residential care', '623'], ['nursing care', '623'],
  ['624', '624'], ['social assistance', '624'], ['asistencia social', '624']
]);

function location(value) {
  const parts = String(value || '').split(',').map(x => x.trim()).filter(Boolean);
  return {city: readable(parts[0]) || null, region: readable(parts.at(-1)) || null};
}

function toFacility(r) {
  const id = String(r.Id ?? '').trim();
  const loc = location(r.Ubicacion);
  const road = [r.Tipo_vialidad, r.Calle, r.Num_Exterior].map(x => String(x ?? '').trim()).filter(Boolean).join(' ');
  return facility({
    source: 'mx-inegi',
    id,
    name: r.Nombre,
    specialties: [r.Clase_actividad].filter(Boolean),
    line1: road,
    line2: r.Colonia,
    city: loc.city,
    region: loc.region,
    postalCode: r.CP,
    countryCode: 'MX',
    phone: r.Telefono,
    emailAddress: r.Correo_e,
    url: r.Sitio_internet,
    identifiers: [
      {system: 'INEGI DENUE ID', value: id},
      {system: 'CLEE', value: r.CLEE},
      {system: 'SCIAN', value: r.CLASE_ACTIVIDAD_ID}
    ],
    sourceUrl: HOMEPAGE
  });
}

async function areaQuery({state = '00', sub = '0', name = '0', first = 1, last = 2, id = '0'}, ctx) {
  const token = ctx.env?.INEGI_DENUE_TOKEN;
  if (!token) throw new ApiError(503, 'source_not_configured', 'Mexico requires INEGI_DENUE_TOKEN.');
  // Official order: state/municipality/locality/AGEB/block/sector/subsector/branch/class/name/first/last/id/token.
  const parts = ['BuscarAreaAct', state, '0', '0', '0', '0', '62', sub, '0', '0', name, String(first), String(last), id, token];
  const url = new URL(ROOT + '/' + parts.map(x => encodeURIComponent(x)).join('/'));
  let body;
  try {
    ({body} = await fetchJson(url, ctx));
  } catch (error) {
    // The official registry sometimes signals zero matches with HTTP 404.
    if (error instanceof ApiError && error.status === 404) return [];
    throw error;
  }
  if (Array.isArray(body)) return body;
  const message = typeof body === 'string' ? body : body?.Message || body?.Mensaje || body?.message;
  if (body == null || message && /no se encontr|sin resultados|no results/i.test(message)) return [];
  throw new ApiError(502, 'upstream_error', 'INEGI returned an unexpected response.');
}

export const mxInegi = {
  id: 'mx-inegi',
  name: 'INEGI DENUE — Salud y Asistencia Social',
  authority: 'Instituto Nacional de Estadística y Geografía (INEGI)',
  homepage: HOMEPAGE,
  country: 'MX',
  secret: 'INEGI_DENUE_TOKEN',
  filters: ['name', 'region', 'specialty'],
  notes: 'Search the official INEGI DENUE API, restricted to healthcare/social-assistance sector 62. Region is a two-digit state code (01–32); specialty supports hospital, ambulatory, residential care, social assistance, and their respective SCIAN subsector codes. City and postal-code filtering are not provided by this endpoint.',
  maxPerPage: 50,
  idPattern: ID,

  validate(q) {
    if (q.region && !/^(0[1-9]|[12][0-9]|3[0-2])$/.test(q.region)) {
      throw invalid('For Mexico, region must be a two-digit INEGI state code from 01 to 32.');
    }
    if (q.specialty && !SUBSECTORS.has(q.specialty.toLowerCase())) {
      throw invalid('Supported Mexico specialty filters: hospital (622), outpatient (621), residential care (623), social assistance (624).');
    }
  },

  async search(q, ctx) {
    const first = (q.page - 1) * q.per_page + 1;
    const result = await areaQuery({
      state: q.region || '00',
      sub: q.specialty ? SUBSECTORS.get(q.specialty.toLowerCase()) : '0',
      name: q.name || '0',
      first,
      last: first + q.per_page
    }, ctx);
    const valid = result.slice(0, q.per_page).filter(r => r?.Id != null && r?.Nombre);
    return {
      items: valid.map(toFacility),
      total: null,
      hasMore: result.length > q.per_page
    };
  },

  async get(id, ctx) {
    // Search by DENUE ID *within sector 62*, rather than allowing arbitrary non-health businesses.
    const rows = await areaQuery({id, first: 1, last: 2}, ctx);
    const row = rows.find(r => String(r.Id) === id);
    if (!row) throw notFound('No DENUE healthcare establishment with this identifier.');
    return toFacility(row);
  }
};
