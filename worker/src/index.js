/* Global Healthcare Directory — national healthcare registry API (Cloudflare Worker, free tier).
 *
 *   GET /health                         status and which registries are configured
 *   GET /sources                        connected registries, countries, supported filters
 *   GET /search?country=GB&name=…       search by country, location, name, and specialty
 *   GET /facilities/:source/:id         one facility record
 *
 * Read-only: GET/HEAD/OPTIONS only. Queries registries live on request; there is no scraping,
 * Registry records remain live/read-only. Logo enrichment uses two dedicated Neon projects.
 * Secrets (e.g. ESANTE_API_KEY) are Worker Secrets and never appear in responses or logs. */
import {logoRoute} from './logos.js';
import {runLogoJobs} from './logo-jobs.js';
import {ApiError, invalid, notFound, json} from './http.js';
import {usNppes} from './sources/us-nppes.js';
import {gbNhsOds} from './sources/gb-nhs-ods.js';
import {frAnnuaireSante} from './sources/fr-annuaire-sante.js';
import {coReps} from './sources/co-reps.js';
import {mxInegi} from './sources/mx-inegi.js';
import {sgChas} from './sources/sg-chas.js';

export const SOURCES = [usNppes, gbNhsOds, frAnnuaireSante, coReps, mxInegi, sgChas];
const byId = new Map(SOURCES.map(s => [s.id, s]));
const SEARCH_PARAMS = new Set(['country', 'source', 'name', 'city', 'region', 'postal_code', 'specialty', 'page', 'per_page', 'cursor']);
const RATE_LIMIT = 60; // requests per minute per client IP (per Worker isolate; best-effort on the free tier)
const CACHE_SECONDS = 300;

const configured = (source, env) => !source.disabledReason && (!source.secret || Boolean(env?.[source.secret]));
const secretsOf = env => SOURCES.map(s => s.secret && env?.[s.secret]).filter(Boolean);

/* ---------- CORS (FRONTEND_ORIGIN may list several origins, comma-separated) ---------- */
function allowedOrigins(env) {
  return String(env?.FRONTEND_ORIGIN || '').split(',').map(o => o.trim().replace(/\/+$/, '')).filter(Boolean);
}
function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const headers = {Vary: 'Origin'};
  if (origin && allowedOrigins(env).includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = 'GET, HEAD, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Accept, Content-Type';
    headers['Access-Control-Max-Age'] = '86400';
  }
  return headers;
}

/* ---------- Rate limiting ---------- */
const buckets = new Map();
export function rateLimited(ip, now = Date.now(), limit = RATE_LIMIT) {
  const windowStart = now - 60_000;
  const hits = (buckets.get(ip) || []).filter(t => t > windowStart);
  hits.push(now);
  buckets.set(ip, hits);
  if (buckets.size > 5000) for (const [key, list] of buckets) if (!list.some(t => t > windowStart)) buckets.delete(key);
  return hits.length > limit ? Math.ceil((hits[0] + 60_000 - now) / 1000) : 0;
}
export const _resetRateLimit = () => buckets.clear();

/* ---------- Validation ---------- */
const TEXT = /^[\p{L}\p{M}\p{N} .,'’&()/-]+$/u;
function text(value, field, max) {
  if (value === null) return null;
  const v = value.replace(/\s+/g, ' ').trim().replace(/\*/g, '');
  if (!v) return null;
  if (v.length > max) throw invalid(`${field} must be at most ${max} characters.`);
  if (!TEXT.test(v)) throw invalid(`${field} contains unsupported characters.`);
  return v;
}
function int(value, field, min, max, fallback) {
  if (value === null || value === '') return fallback;
  if (!/^\d+$/.test(value) || Number(value) < min || Number(value) > max) throw invalid(`${field} must be a whole number from ${min} to ${max}.`);
  return Number(value);
}

export function parseSearch(params) {
  const unknown = [...params.keys()].filter(k => !SEARCH_PARAMS.has(k));
  if (unknown.length) throw invalid(`Unsupported parameter: ${unknown.join(', ')}.`, {allowed: [...SEARCH_PARAMS]});
  for (const key of params.keys()) if (params.getAll(key).length > 1) throw invalid(`Parameter ${key} may only be given once.`);
  const country = (params.get('country') || '').trim().toUpperCase();
  const sourceId = (params.get('source') || '').trim();
  if (!country && !sourceId) throw invalid('Give a country (ISO 3166-1 alpha-2, e.g. GB) or a source.');
  if (country && !/^[A-Z]{2}$/.test(country)) throw invalid('country must be a two-letter ISO 3166-1 code, e.g. US, GB, FR.');
  const q = {
    country,
    sourceId,
    name: text(params.get('name'), 'name', 100),
    city: text(params.get('city'), 'city', 80),
    region: params.get('region') ? params.get('region').trim().toUpperCase() : null,
    postal_code: params.get('postal_code') ? params.get('postal_code').trim() : null,
    specialty: text(params.get('specialty'), 'specialty', 80),
    page: int(params.get('page'), 'page', 1, 100, 1),
    per_page: int(params.get('per_page'), 'per_page', 1, 50, 20),
    cursor: params.get('cursor') ? params.get('cursor').trim() : null
  };
  if (q.region && !/^[A-Z0-9-]{1,10}$/.test(q.region)) throw invalid('region must be a short region code, e.g. MA.');
  if (q.postal_code && !/^[A-Za-z0-9 -]{2,10}$/.test(q.postal_code)) throw invalid('postal_code must be 2–10 letters, digits, spaces or hyphens.');
  if (q.cursor && !/^[A-Za-z0-9_-]{1,2000}$/.test(q.cursor)) throw invalid('Invalid cursor.');
  return q;
}

function pickSource(q, env) {
  let source;
  if (q.sourceId) {
    source = byId.get(q.sourceId);
    if (!source) throw invalid(`Unknown source "${q.sourceId}".`, {sources: [...byId.keys()]});
    if (q.country && q.country !== source.country) throw invalid(`Source ${source.id} covers ${source.country}, not ${q.country}.`);
  } else {
    source = SOURCES.find(s => s.country === q.country);
    if (!source) {
      throw new ApiError(404, 'no_registry', `No national healthcare registry is connected for ${q.country}.`,
        {supported_countries: [...new Set(SOURCES.map(s => s.country))]});
    }
  }
  if (source.disabledReason) throw new ApiError(503, 'source_unavailable', source.disabledReason);
  if (!configured(source, env)) {
    throw new ApiError(503, 'source_not_configured', `The ${source.name} needs the ${source.secret} Worker secret before it can be searched.`);
  }
  const used = ['name', 'city', 'region', 'postal_code', 'specialty'].filter(f => q[f]);
  const unsupported = used.filter(f => !source.filters.includes(f));
  if (unsupported.length) throw invalid(`${source.name} does not support filtering by ${unsupported.join(', ')}.`, {supported_filters: source.filters});
  if (q.cursor && !source.cursorPaging) throw invalid('cursor is only used by registries that page with next_cursor.');
  if (q.per_page > source.maxPerPage) throw invalid(`per_page may be at most ${source.maxPerPage} for ${source.id}.`);
  source.validate(q);
  return source;
}

function describe(source, env) {
  return {
    id: source.id, name: source.name, authority: source.authority, homepage: source.homepage,
    country: source.country, filters: source.filters, notes: source.notes,
    paging: source.cursorPaging ? 'cursor' : 'page', max_per_page: source.maxPerPage,
    requires_secret: source.secret, configured: configured(source, env)
  };
}

/* ---------- Routing ---------- */
async function route(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const upstream = {env, secrets: secretsOf(env), timeoutMs: ctx?.timeoutMs || 8000, fetchImpl: ctx?.fetchImpl};

  if (path.startsWith('/logos/')) {
    const result=await logoRoute(request,env,ctx);
    if(result) return result;
  }
  if (path === '/' || path === '/health') {
    return {body: {status: 'ok', service: 'healthcare-directory-api', logos: {usa: Boolean(env.HEALTHCARE_DIRECTORY_US_LOGO_DATABASE_URL), international: Boolean(env.HEALTHCARE_DIRECTORY_INTERNATIONAL_LOGO_DATABASE_URL)}, sources: SOURCES.map(s => ({id: s.id, country: s.country, configured: configured(s, env)}))}, cache: 0};
  }
  if (path === '/sources') {
    if ([...url.searchParams.keys()].length) throw invalid('/sources takes no parameters.');
    return {body: {sources: SOURCES.map(s => describe(s, env))}, cache: 60};
  }
  if (path === '/search') {
    const q = parseSearch(url.searchParams);
    const source = pickSource(q, env);
    const result = await source.search(q, upstream);
    return {
      body: {
        source: source.id, country: source.country,
        query: Object.fromEntries(['name', 'city', 'region', 'postal_code', 'specialty'].filter(f => q[f]).map(f => [f, q[f]])),
        applied_filters: result.appliedFilters,
        page: source.cursorPaging ? null : q.page, per_page: q.per_page,
        total: result.total, has_more: result.hasMore, next_cursor: result.nextCursor || null,
        count: result.items.length, items: result.items
      },
      cache: CACHE_SECONDS
    };
  }
  const match = /^\/facilities\/([a-z0-9-]+)\/([^/]+)$/.exec(path);
  if (match) {
    if ([...url.searchParams.keys()].length) throw invalid('This endpoint takes no query parameters.');
    const source = byId.get(match[1]);
    if (!source) throw notFound(`Unknown source "${match[1]}".`);
    let id;
    try { id = decodeURIComponent(match[2]); } catch { throw invalid('Invalid facility id.'); }
    if (!source.idPattern.test(id)) throw invalid(`Invalid ${source.id} facility id.`);
    if (source.disabledReason) throw new ApiError(503, 'source_unavailable', source.disabledReason);
    if (!configured(source, env)) throw new ApiError(503, 'source_not_configured', `The ${source.name} needs the ${source.secret} Worker secret.`);
    return {body: {facility: await source.get(id, upstream)}, cache: CACHE_SECONDS};
  }
  throw notFound('Unknown endpoint. See /sources.');
}

export default {
  async scheduled(controller,env,ctx) { ctx.waitUntil(runLogoJobs(env,controller.scheduledTime)); },
  async fetch(request, env, ctx = {}) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors});
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return json({error: {code: 'method_not_allowed', message: 'This API is read-only.'}}, 405, {...cors, Allow: 'GET, HEAD, OPTIONS'});
    }
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const logoRequest = new URL(request.url).pathname.startsWith('/logos/');
    const retry = rateLimited(ip + (logoRequest ? ':logos' : ''), Date.now(), logoRequest ? 240 : RATE_LIMIT);
    if (retry) return json({error: {code: 'rate_limited', message: 'Too many requests. Please slow down.'}}, 429, {...cors, 'Retry-After': String(retry)});

    // Edge cache (best effort; the Cache API is a no-op where unavailable).
    const cache = typeof caches !== 'undefined' ? caches.default : null;
    const cacheKey = new Request(new URL(request.url).toString(), {method: 'GET'});
    if (cache) {
      try {
        const hit = await cache.match(cacheKey);
        if (hit) {
          const response = new Response(request.method === 'HEAD' ? null : hit.body, hit);
          for (const [k, v] of Object.entries(cors)) response.headers.set(k, v);
          return response;
        }
      } catch { /* cache unavailable */ }
    }
    try {
      const result = await route(request, env, ctx);
      if(result instanceof Response) {
        for(const [k,v] of Object.entries(cors)) result.headers.set(k,v);
        return request.method==='HEAD' ? new Response(null,result) : result;
      }
      const {body, cache: seconds} = result;
      const response = json(body, 200, {'Cache-Control': seconds ? `public, max-age=${seconds}` : 'no-store'});
      if (cache && seconds && ctx.waitUntil) {
        try { ctx.waitUntil(cache.put(cacheKey, response.clone())); } catch { /* ignore */ }
      }
      for (const [k, v] of Object.entries(cors)) response.headers.set(k, v);
      return request.method === 'HEAD' ? new Response(null, response) : response;
    } catch (error) {
      if (error instanceof ApiError) {
        return json({error: {code: error.code, message: error.message, ...(error.details ? {details: error.details} : {})}}, error.status, {...cors, 'Cache-Control': 'no-store'});
      }
      console.error('unhandled error', error?.name);
      return json({error: {code: 'internal_error', message: 'Unexpected error.'}}, 500, {...cors, 'Cache-Control': 'no-store'});
    }
  }
};
