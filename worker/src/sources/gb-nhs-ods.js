/* United Kingdom — NHS England Organisation Data Service (ODS), ORD API 2-0-0. Public, keyless.
 * Covers NHS and care organisations (trusts, hospitals, GP practices, pharmacies, dentists, …).
 * Docs: https://digital.nhs.uk/developer/api-catalogue/organisation-data-service-ord */
import {fetchJson, invalid, notFound} from '../http.js';
import {facility} from '../facility.js';

const BASE = 'https://directory.spineservices.nhs.uk/ORD/2-0-0';
let rolesCache = null; // ODS role catalogue (~200 entries), cached per Worker isolate

async function roles(ctx) {
  if (rolesCache && rolesCache.expires > Date.now()) return rolesCache.map;
  const {body} = await fetchJson(new URL(`${BASE}/roles`), ctx);
  const map = new Map((body?.Roles || []).map(r => [r.id, r.displayName]));
  rolesCache = {map, expires: Date.now() + 6 * 3600 * 1000};
  return map;
}

/* Specialty text → the best matching ODS role (exact name first, then the shortest containing it). */
async function roleFor(specialty, ctx) {
  const wanted = specialty.toUpperCase();
  const all = [...(await roles(ctx)).entries()].filter(([, name]) => name.includes(wanted));
  if (!all.length) throw invalid(`No NHS organisation type matches "${specialty}". Try e.g. "pharmacy", "GP practice", "dental", "NHS trust", or "hospice".`);
  all.sort((a, b) => (a[1] === wanted ? -1 : b[1] === wanted ? 1 : a[1].length - b[1].length));
  return {id: all[0][0], name: all[0][1]};
}

function searchFacility(o, roleNames) {
  return facility({
    source: 'gb-nhs-ods',
    id: o.OrgId,
    name: o.Name,
    specialties: [o.PrimaryRoleDescription || roleNames?.get(o.PrimaryRoleId)],
    status: o.Status?.toLowerCase(),
    postalCode: o.PostCode,
    countryCode: 'GB',
    identifiers: [{system: 'ODS', value: o.OrgId}],
    updatedAt: o.LastChangeDate,
    sourceUrl: `${BASE}/organisations/${encodeURIComponent(o.OrgId)}`
  });
}

export const gbNhsOds = {
  id: 'gb-nhs-ods',
  name: 'NHS Organisation Data Service (ODS)',
  authority: 'NHS England',
  homepage: 'https://digital.nhs.uk/services/organisation-data-service',
  country: 'GB',
  secret: null,
  filters: ['name', 'postal_code', 'specialty'],
  notes: 'Specialty is matched to an ODS organisation type (e.g. pharmacy, GP practice, NHS trust). Only active organisations are returned.',
  maxPerPage: 50,
  idPattern: /^[A-Z0-9]{3,12}$/i,

  validate() {},

  async search(q, ctx) {
    const url = new URL(`${BASE}/organisations`);
    if (q.name) url.searchParams.set('Name', q.name);
    if (q.postal_code) url.searchParams.set('PostCode', q.postal_code.toUpperCase());
    let applied = null;
    if (q.specialty) {
      applied = await roleFor(q.specialty, ctx);
      url.searchParams.set('PrimaryRoleId', applied.id);
    }
    url.searchParams.set('Status', 'Active');
    url.searchParams.set('Limit', String(q.per_page));
    // ODS Offset is a 0-based skip but rejects 0 (HTTP 406), so it is omitted on page 1.
    if (q.page > 1) url.searchParams.set('Offset', String((q.page - 1) * q.per_page));
    const {body, headers} = await fetchJson(url, ctx);
    const rows = Array.isArray(body?.Organisations) ? body.Organisations : [];
    const total = Number(headers.get('x-total-count'));
    const known = Number.isFinite(total) && headers.get('x-total-count') !== null;
    return {
      items: rows.map(o => searchFacility(o)),
      total: known ? total : null,
      hasMore: known ? q.page * q.per_page < total : rows.length === q.per_page,
      appliedFilters: applied ? {specialty: applied.name} : undefined
    };
  },

  async get(id, ctx) {
    const {body} = await fetchJson(new URL(`${BASE}/organisations/${encodeURIComponent(id.toUpperCase())}`), ctx);
    const o = body?.Organisation;
    if (!o) throw notFound('No NHS organisation with this ODS code.');
    const loc = o.GeoLoc?.Location || {};
    const contacts = [].concat(o.Contacts?.Contact || []);
    const roleList = [].concat(o.Roles?.Role || []);
    const primary = roleList.find(r => r.primaryRole) || roleList[0];
    let roleNames = null;
    try { roleNames = await roles(ctx); } catch { /* role names are optional detail */ }
    const specialties = [primary, ...roleList.filter(r => r !== primary && r.Status === 'Active')]
      .filter(Boolean).map(r => roleNames?.get(r.id)).filter(Boolean);
    return facility({
      source: 'gb-nhs-ods',
      id: o.OrgId?.extension || id.toUpperCase(),
      name: o.Name,
      specialties,
      status: o.Status?.toLowerCase(),
      line1: [loc.AddrLn1, loc.AddrLn2].filter(Boolean).join(', '),
      line2: loc.AddrLn3,
      city: loc.Town,
      region: loc.County || loc.Country,
      postalCode: loc.PostCode,
      countryCode: 'GB',
      phone: contacts.find(c => c.type === 'tel')?.value,
      url: contacts.find(c => c.type === 'http')?.value,
      identifiers: [{system: 'ODS', value: o.OrgId?.extension || id.toUpperCase()}],
      updatedAt: o.LastChangeDate,
      sourceUrl: `${BASE}/organisations/${encodeURIComponent(id.toUpperCase())}`
    });
  }
};

export const _resetRolesCache = () => { rolesCache = null; };
