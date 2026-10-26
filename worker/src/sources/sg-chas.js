/* Singapore — official MOH CHAS Clinics GeoJSON dataset via data.gov.sg.
 * Published snapshot last updated 6 Jun 2024 (not a real-time licensing registry).
 * Dataset-download API returns a short-lived signed S3 URL; only the Worker retrieves it.
 * Viewer gets standardized facility cards, never GeoJSON, coordinates or file downloads.
 */
import {ApiError, fetchJson, invalid, notFound} from '../http.js';
import {facility} from '../facility.js';

const DATASET_ID = 'd_548c33ea2d99e29ec63a7cc9edcccedc';
const META_URL = 'https://api-open.data.gov.sg/v1/public/api/datasets/' + DATASET_ID + '/poll-download';
const SOURCE_URL = 'https://data.gov.sg/datasets/' + DATASET_ID + '/view';
const SIGNED_HOST = 's3.ap-southeast-1.amazonaws.com';
const SIGNED_PATH = '/blobs.data.gov.sg/' + DATASET_ID + '.geojson';
const ID = /^[A-Za-z0-9-]{3,20}$/;
let snapshot = null;
let snapshotUntil = 0;
let pending = null;

export function _resetChasCache() {
  snapshot = null;
  snapshotUntil = 0;
  pending = null;
}

const entities = text => String(text || '')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&lt;/gi, '<')
  .replace(/&gt;/gi, '>')
  .replace(/&quot;/gi, '"')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

function row(feature) {
  if (!feature?.properties || typeof feature.properties.Description !== 'string') return null;
  const fields = {};
  const rx = /<th\b[^>]*>([^<>]*)<\/th>\s*<td\b[^>]*>([\s\S]*?)<\/td>/gi;
  let pair;
  while ((pair = rx.exec(feature.properties.Description)) !== null) {
    fields[entities(pair[1]).toUpperCase()] = entities(pair[2]);
  }
  if (!ID.test(fields.HCI_CODE || '') || !fields.HCI_NAME) return null;
  return fields;
}

function asFacility(r) {
  const number = [r.BLK_HSE_NO, r.STREET_NAME].filter(Boolean).join(' ');
  const unit = [r.FLOOR_NO, r.UNIT_NO].filter(Boolean).join('-');
  return facility({
    source: 'sg-chas',
    id: r.HCI_CODE,
    name: r.HCI_NAME,
    specialties: [r.LICENCE_TYPE === 'MC' ? 'Medical clinic' : r.LICENCE_TYPE === 'MD' ? 'Medical specialist clinic' : r.LICENCE_TYPE || 'Clinic'],
    line1: number,
    line2: [r.BUILDING_NAME, unit ? '#'+unit : null].filter(Boolean).join(', '),
    city: 'Singapore',
    postalCode: r.POSTAL_CD,
    countryCode: 'SG',
    phone: r.HCI_TEL,
    identifiers: [
      {system: 'MOH HCI code', value: r.HCI_CODE},
      {system: 'CHAS programme', value: r.CLINIC_PROGRAMME_CODE}
    ],
    sourceUrl: SOURCE_URL
  });
}

async function fetchSnapshot(ctx) {
  const {body: meta} = await fetchJson(new URL(META_URL), {
    ...ctx, headers: {'x-api-key': ctx.env.DATA_GOV_SG_API_KEY}
  });
  if (meta?.code !== 0 || typeof meta.data?.url !== 'string') {
    throw new ApiError(502, 'upstream_error', 'CHAS dataset download is unavailable.');
  }
  const signed = new URL(meta.data.url);
  if (signed.protocol !== 'https:' || signed.hostname !== SIGNED_HOST || signed.pathname !== SIGNED_PATH) {
    throw new ApiError(502, 'upstream_error', 'CHAS dataset origin was not recognized.');
  }
  const {body: geojson} = await fetchJson(signed, {...ctx, headers: {}});
  if (geojson?.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
    throw new ApiError(502, 'upstream_error', 'Unexpected CHAS GeoJSON response.');
  }
  const rows = geojson.features.map(row).filter(Boolean);
  if (!rows.length) throw new ApiError(502, 'upstream_error', 'The CHAS clinic dataset contained no valid facilities.');
  rows.sort((a,b) => a.HCI_NAME.localeCompare(b.HCI_NAME) || a.HCI_CODE.localeCompare(b.HCI_CODE));
  return rows;
}

async function load(ctx) {
  if (snapshot && Date.now() < snapshotUntil) return snapshot;
  if (!pending) pending = fetchSnapshot(ctx).then(records => {
    snapshot = records;
    snapshotUntil = Date.now() + 60*60*1000;
    return records;
  }).finally(() => { pending = null; });
  return pending;
}

export const sgChas = {
  id: 'sg-chas',
  name: 'MOH CHAS Clinics (published snapshot)',
  authority: 'Singapore Ministry of Health',
  homepage: SOURCE_URL,
  country: 'SG',
  secret: 'DATA_GOV_SG_API_KEY',
  filters: ['name', 'postal_code', 'specialty'],
  notes: 'CHAS Clinics GeoJSON published by MOH; source last updated 6 June 2024. Clinic records are retrieved through the government dataset API. They do not establish current licensing or open status.',
  maxPerPage: 50,
  idPattern: ID,
  validate(q) {
    if (q.postal_code && !/^\d{6}$/.test(q.postal_code)) throw invalid('Singapore postal_code must have six digits.');
  },
  async search(q,ctx) {
    const all = await load(ctx);
    const search = q.name?.toLocaleLowerCase() || null;
    const postal = q.postal_code || null;
    const service = q.specialty?.toLocaleLowerCase() || null;
    const selected = all.filter(r =>
      (!search || r.HCI_NAME.toLocaleLowerCase().includes(search)) &&
      (!postal || r.POSTAL_CD === postal) &&
      (!service || (r.CLINIC_PROGRAMME_CODE || '').toLocaleLowerCase().includes(service) ||
        (r.LICENCE_TYPE || '').toLocaleLowerCase().includes(service))
    );
    const offset = (q.page - 1)*q.per_page;
    return {items:selected.slice(offset,offset+q.per_page).map(asFacility),total:selected.length,hasMore:offset+q.per_page<selected.length};
  },
  async get(id,ctx) {
    const list=await load(ctx);
    const entry=list.find(r=>r.HCI_CODE.toUpperCase()===id.toUpperCase());
    if(!entry) throw notFound('CHAS clinic not found in the published dataset.');
    return asFacility(entry);
  }
};
