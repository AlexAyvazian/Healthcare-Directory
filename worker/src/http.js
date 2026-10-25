/* Shared HTTP helpers: API errors, JSON responses, and hardened outbound registry requests
 * (GET only, HTTPS only, timeout, size cap, no redirects, secrets never logged). */
export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
export const invalid = (message, details) => new ApiError(400, 'invalid_request', message, details);
export const notFound = (message = 'Not found.') => new ApiError(404, 'not_found', message);

const SECURITY_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'Strict-Transport-Security': 'max-age=31536000'
};

export function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {status, headers: {...SECURITY_HEADERS, ...extraHeaders}});
}

const MAX_BYTES = 4 * 1024 * 1024;
const USER_AGENT = 'GlobalHealthcareDirectory/1.0 (+https://healthcare-directory-u2l1.onrender.com)';

/* Fetch JSON from a registry. `secrets` are only used to scrub log lines. */
export async function fetchJson(url, {headers = {}, timeoutMs = 8000, secrets = [], fetchImpl = fetch} = {}) {
  if (!(url instanceof URL) || url.protocol !== 'https:') throw new Error('Registry URLs must be HTTPS.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const where = `${url.hostname}${url.pathname}`;
  let response;
  try {
    response = await fetchImpl(url.toString(), {
      method: 'GET',
      headers: {Accept: 'application/json, application/fhir+json', 'User-Agent': USER_AGENT, ...headers},
      redirect: 'manual',
      signal: controller.signal
    });
  } catch (error) {
    clearTimeout(timer);
    if (error?.name === 'AbortError') throw new ApiError(504, 'upstream_timeout', 'The healthcare registry took too long to respond.');
    console.warn('registry request failed', scrub(where, secrets), error?.name);
    throw new ApiError(502, 'upstream_error', 'The healthcare registry could not be reached.');
  }
  try {
    const status = response.status;
    if (status === 404 || status === 410) throw notFound('Facility not found in this registry.');
    if (status === 401 || status === 403) {
      console.warn('registry rejected credentials', scrub(where, secrets), status);
      throw new ApiError(503, 'source_credentials_rejected', 'The registry rejected the configured API key.');
    }
    if (status === 429) throw new ApiError(503, 'upstream_rate_limited', 'The healthcare registry is busy. Try again shortly.');
    if (status === 400) {
      const detail = await safeBody(response);
      throw invalid('The registry rejected these search criteria.', detail);
    }
    if (status < 200 || status >= 300) {
      console.warn('registry HTTP error', scrub(where, secrets), status);
      throw new ApiError(502, 'upstream_error', 'The healthcare registry returned an error.');
    }
    if (Number(response.headers.get('content-length') || 0) > MAX_BYTES) throw new ApiError(502, 'upstream_error', 'Registry response too large.');
    const text = await response.text();
    if (text.length > MAX_BYTES) throw new ApiError(502, 'upstream_error', 'Registry response too large.');
    try {
      return {body: JSON.parse(text), headers: response.headers};
    } catch {
      throw new ApiError(502, 'upstream_error', 'The healthcare registry returned an unreadable response.');
    }
  } finally {
    clearTimeout(timer);
  }
}

async function safeBody(response) {
  try {
    const body = await response.json();
    // FHIR OperationOutcome or generic message, trimmed; never echo headers or URLs.
    const message = body?.issue?.[0]?.diagnostics || body?.message || body?.error;
    return message ? String(message).slice(0, 300) : undefined;
  } catch { return undefined; }
}

export function scrub(text, secrets = []) {
  let out = String(text);
  for (const secret of secrets) if (secret && secret.length >= 4) out = out.split(secret).join('[redacted]');
  return out;
}
