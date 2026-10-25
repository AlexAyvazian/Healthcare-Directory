/* France — Agence du Numérique en Santé (ANS), API FHIR Annuaire Santé en libre accès, v2.
 * Requires the ESANTE_API_KEY Worker secret (free key from https://portal.api.esante.gouv.fr).
 * Docs: https://ansforge.github.io/annuaire-sante-fhir-documentation/ (resource: Organization) */
import {fetchJson, invalid, notFound} from '../http.js';
import {facility} from '../facility.js';

const BASE = 'https://gateway.api.esante.gouv.fr/fhir/v2';
const PAGE_LINK_ORIGIN = 'https://gateway.api.esante.gouv.fr';

const ident = (resource, system) => resource.identifier?.find(i => i.system?.includes(system))?.value;

function toFacility(o) {
  const address = o.address?.[0] || {};
  const telecom = o.telecom || [];
  const types = (o.type || []).flatMap(t => t.coding || []).map(c => c.display).filter(Boolean);
  return facility({
    source: 'fr-annuaire-sante',
    id: o.id,
    name: o.name || o.alias?.[0],
    specialties: types,
    status: o.active === false ? 'inactive' : o.active === true ? 'active' : null,
    line1: address.line?.[0],
    line2: address.line?.slice(1).join(', '),
    city: address.city,
    region: address.district || address.state,
    postalCode: address.postalCode,
    countryCode: 'FR',
    phone: telecom.find(t => t.system === 'phone')?.value,
    emailAddress: telecom.find(t => t.system === 'email')?.value,
    url: telecom.find(t => t.system === 'url')?.value,
    identifiers: (o.identifier || []).map(i => ({system: i.type?.coding?.[0]?.code || i.system, value: i.value})),
    updatedAt: o.meta?.lastUpdated
  });
}

/* FHIR paging uses opaque "next" links; they are passed back to clients as a base64url cursor and
 * only ever followed if they point at the same ANS gateway. */
export function encodeCursor(link) {
  const url = new URL(link);
  if (url.origin !== PAGE_LINK_ORIGIN) return null;
  return btoa(url.pathname + url.search).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decodeCursor(cursor) {
  let path;
  try { path = atob(cursor.replace(/-/g, '+').replace(/_/g, '/')); } catch { throw invalid('Invalid cursor.'); }
  if (!path.startsWith('/fhir/v2/')) throw invalid('Invalid cursor.');
  const url = new URL(path, PAGE_LINK_ORIGIN);
  if (url.origin !== PAGE_LINK_ORIGIN) throw invalid('Invalid cursor.');
  return url;
}

export const frAnnuaireSante = {
  id: 'fr-annuaire-sante',
  name: 'Annuaire Santé (RASS) — API FHIR',
  authority: 'Agence du Numérique en Santé (ANS)',
  homepage: 'https://annuaire.sante.fr/',
  country: 'FR',
  secret: 'ESANTE_API_KEY',
  filters: ['name', 'city', 'postal_code'],
  notes: 'Pages are followed with the next_cursor value from the previous response.',
  maxPerPage: 50,
  idPattern: /^[A-Za-z0-9.-]{1,64}$/,
  cursorPaging: true,

  validate(q) {
    if (q.page !== 1) throw invalid('This registry pages with next_cursor; omit page and pass cursor from the previous response.');
  },

  async search(q, ctx) {
    const headers = {'ESANTE-API-KEY': ctx.env.ESANTE_API_KEY};
    let url;
    if (q.cursor) {
      url = decodeCursor(q.cursor);
    } else {
      url = new URL(`${BASE}/Organization`);
      if (q.name) url.searchParams.set('name:contains', q.name);
      if (q.city) url.searchParams.set('address-city', q.city);
      if (q.postal_code) url.searchParams.set('address-postalcode', q.postal_code.replace(/\s/g, ''));
      url.searchParams.set('_count', String(q.per_page));
    }
    const {body} = await fetchJson(url, {...ctx, headers});
    if (body?.resourceType !== 'Bundle') throw invalid('Unexpected registry response.');
    const items = (body.entry || []).map(e => e.resource).filter(r => r?.resourceType === 'Organization').map(toFacility);
    const next = (body.link || []).find(l => l.relation === 'next')?.url;
    const nextCursor = next ? encodeCursor(next) : null;
    return {items, total: Number.isFinite(body.total) ? body.total : null, hasMore: Boolean(nextCursor), nextCursor};
  },

  async get(id, ctx) {
    const {body} = await fetchJson(new URL(`${BASE}/Organization/${encodeURIComponent(id)}`), {...ctx, headers: {'ESANTE-API-KEY': ctx.env.ESANTE_API_KEY}});
    if (body?.resourceType !== 'Organization') throw notFound('No organisation with this identifier.');
    return toFacility(body);
  }
};
