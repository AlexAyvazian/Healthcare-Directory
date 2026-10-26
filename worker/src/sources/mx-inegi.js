/* Mexico — INEGI DENUE healthcare-and-social-assistance hosted feature layer 62.
 * Live read-only ArcGIS REST queries; no API token is required for this public layer.
 * The source publishes a snapshot, so it is not proof of real-time operating status.
 * The website's map remains region-only: coordinates are not returned to viewers. */
import {fetchJson, invalid, notFound} from '../http.js';
import {facility} from '../facility.js';

const BASE = 'https://lcidsig.inegi.org.mx/server/rest/services/Hosted/denue_inegi_62_/FeatureServer/0';
const FIELDS = 'id,clee,nom_estab,codigo_act,nombre_act,tipo_vial,nom_vial,numero_ext,nomb_asent,localidad,municipio,entidad,cve_ent,cve_mun,cod_postal,telefono,correoelec,www,fecha_alta';
const ID = /^[0-9]{1,15}$/;
const value = x => String(x ?? '').trim();
const sqlString = x => "'" + value(x).replace(/'/g, "''") + "'";
const includes = (field, v) => 'UPPER(' + field + ') LIKE ' + sqlString('%' + v.toUpperCase() + '%');

function toFacility(r) {
  const id = value(r.id);
  const addr = [r.tipo_vial, r.nom_vial, r.numero_ext].map(value).filter(x => x && x !== '0').join(' ');
  return facility({
    source: 'mx-inegi',
    id,
    name: r.nom_estab,
    specialties: [r.nombre_act].filter(Boolean),
    line1: addr,
    line2: r.nomb_asent,
    city: r.localidad || r.municipio,
    region: r.entidad,
    postalCode: r.cod_postal,
    countryCode: 'MX',
    phone: r.telefono,
    emailAddress: r.correoelec,
    url: r.www,
    identifiers: [{system: 'INEGI DENUE ID', value: id}, {system: 'CLEE', value: r.clee}, {system: 'SCIAN', value: r.codigo_act}],
    sourceUrl: BASE
  });
}

async function query(where, page, perPage, ctx) {
  const url = new URL(BASE + '/query');
  url.searchParams.set('where', where);
  url.searchParams.set('outFields', FIELDS);
  url.searchParams.set('returnGeometry', 'false');
  url.searchParams.set('orderByFields', 'id ASC');
  url.searchParams.set('resultOffset', String((page - 1) * perPage));
  url.searchParams.set('resultRecordCount', String(perPage));
  url.searchParams.set('f', 'json');
  const {body} = await fetchJson(url, ctx);
  if (body?.error || !Array.isArray(body?.features)) throw new Error('Unexpected INEGI response');
  return body.features.map(f => f.attributes).filter(Boolean);
}

export const mxInegi = {
  id: 'mx-inegi',
  name: 'INEGI DENUE — Salud y Asistencia Social',
  authority: 'Instituto Nacional de Estadística y Geografía (INEGI)',
  homepage: 'https://www.inegi.org.mx/app/mapa/denue/',
  country: 'MX',
  secret: null,
  filters: ['name', 'city', 'region', 'postal_code', 'specialty'],
  notes: 'Live search of the public INEGI DENUE hosted layer 62. Region accepts a two-digit INEGI state code (01–32); specialty matches the economic activity description.',
  maxPerPage: 50,
  idPattern: ID,

  validate(q) {
    if (q.region && !/^(0[1-9]|[12][0-9]|3[0-2])$/.test(q.region)) {
      throw invalid('For Mexico, region must be a two-digit INEGI state code from 01 to 32.');
    }
    if (q.page * q.per_page > 10000) throw invalid('Refine the search to browse beyond the first 10,000 DENUE results.');
  },

  async search(q, ctx) {
    const clauses = ['1=1'];
    if (q.region) clauses.push('cve_ent = ' + sqlString(q.region));
    if (q.name) clauses.push(includes('nom_estab', q.name));
    if (q.city) clauses.push('(' + includes('municipio', q.city) + ' OR ' + includes('localidad', q.city) + ')');
    if (q.postal_code) clauses.push('cod_postal = ' + sqlString(q.postal_code.replace(/\s/g, '')));
    if (q.specialty) clauses.push(includes('nombre_act', q.specialty));
    const rows = await query(clauses.join(' AND '), q.page, q.per_page + 1, ctx);
    return {items: rows.slice(0, q.per_page).filter(r => r.id != null).map(toFacility), total: null, hasMore: rows.length > q.per_page};
  },

  async get(id, ctx) {
    const rows = await query('id = ' + id, 1, 2, ctx);
    const row = rows.find(r => String(r.id) === id);
    if (!row) throw notFound('DENUE establishment not found.');
    return toFacility(row);
  }
};
