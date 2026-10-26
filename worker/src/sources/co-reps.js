/* Colombia — official REPS establishments and locations, published as a Socrata dataset.
 * Public, read-only, keyless API. Queries the upstream registry on every cache miss.
 * This is a dated published snapshot, not evidence of real-time license status.
 * https://www.datos.gov.co/resource/c36g-9fc2.json */
import {fetchJson, invalid, notFound} from '../http.js';
import {facility} from '../facility.js';

const BASE = 'https://www.datos.gov.co/resource/c36g-9fc2.json';
const DATASET = 'https://www.datos.gov.co/d/c36g-9fc2';
const ID = /^[0-9]{8,20}$/;

/* Escape literal SoQL strings; all column names below are fixed, never user supplied. */
function literal(value) {
  return "'" + String(value).replace(/'/g, "''") + "'";
}
function contains(field, value) {
  return 'upper(' + field + ') like ' + literal('%' + value.toUpperCase() + '%');
}
function toFacility(r) {
  const id = r.codigohabilitacionsede;
  return facility({
    source: 'co-reps',
    id,
    name: r.nombresede || r.nombreprestador,
    specialties: [r.claseprestador].filter(Boolean),
    line1: r.direcci_nsede || r.direccionprestador,
    city: r.municipiosededesc,
    region: r.departamentodededesc,
    countryCode: 'CO',
    phone: r.t_lefonosede || r.telefonoprestador,
    emailAddress: r.email_sede || r.email_prestador,
    identifiers: [{system: 'REPS site code', value: id}, {system: 'REPS provider code', value: r.codigoprestador}],
    sourceUrl: DATASET
  });
}

export const coReps = {
  id: 'co-reps',
  name: 'Registro Especial de Prestadores y Sedes de Servicios de Salud (REPS)',
  authority: 'Ministerio de Salud y Protección Social de Colombia',
  homepage: DATASET,
  country: 'CO',
  secret: null,
  filters: ['name', 'city', 'region', 'specialty'],
  notes: 'Reads the official published REPS snapshot live via Socrata. Region accepts a two-digit DANE department code (e.g. 91 for Amazonas); this is not a real-time licensing check.',
  maxPerPage: 50,
  idPattern: ID,

  validate(q) {
    if (q.region && !/^[0-9]{2}$/.test(q.region)) throw invalid('For Colombia, region must be a two-digit DANE department code, e.g. 91 for Amazonas.');
  },

  async search(q, ctx) {
    const where = [];
    if (q.name) where.push(contains('nombresede', q.name));
    if (q.city) where.push(contains('municipiosededesc', q.city));
    if (q.region) where.push('municipiosede like ' + literal(q.region + '%'));
    if (q.specialty) where.push(contains('claseprestador', q.specialty));
    const url = new URL(BASE);
    if (where.length) url.searchParams.set('$where', where.join(' AND '));
    url.searchParams.set('$order', 'codigohabilitacionsede ASC');
    url.searchParams.set('$limit', String(q.per_page + 1));
    url.searchParams.set('$offset', String((q.page - 1) * q.per_page));
    const {body} = await fetchJson(url, ctx);
    if (!Array.isArray(body)) throw new Error('Unexpected REPS response');
    return {items: body.slice(0, q.per_page).filter(r => r?.codigohabilitacionsede).map(toFacility), total: null, hasMore: body.length > q.per_page};
  },

  async get(id, ctx) {
    const url = new URL(BASE);
    url.searchParams.set('codigohabilitacionsede', id);
    url.searchParams.set('$limit', '2');
    const {body} = await fetchJson(url, ctx);
    const row = Array.isArray(body) ? body.find(r => String(r.codigohabilitacionsede) === id) : null;
    if (!row) throw notFound('REPS site not found.');
    return toFacility(row);
  }
};
