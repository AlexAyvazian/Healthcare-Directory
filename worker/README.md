# healthcare-directory-api (Cloudflare Worker)

A read-only API that searches **national healthcare registries** live, on request, and returns one
standardized facility format. It runs on the Cloudflare Workers **free tier**:

* no bindings (no KV, D1, R2, Durable Objects or Queues);
* no cron triggers, scraping or stored copies of registry data;
* no server that sleeps.

It does not connect to either Neon database. Those stay exactly as they are.

Worker: `healthcare-directory-api` · URL: <https://healthcare-directory-api.alexa186469.workers.dev>

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | Status, and which registries are configured |
| GET | `/sources` | Connected registries, their countries and supported filters (never secret values) |
| GET | `/search` | Search by country, location, name and specialty |
| GET | `/facilities/:source/:id` | One facility, e.g. `/facilities/gb-nhs-ods/RJ1` |

`/search` parameters:

| Parameter | Meaning |
| --- | --- |
| `country` | ISO 3166-1 alpha-2 code: `US`, `GB`, `FR`, `CO` or `MX` (or use `source` instead) |
| `name` | Facility or organisation name (max 100 characters) |
| `city` | City or town |
| `region` | State or region code (US: a two-letter state code) |
| `postal_code` | Postal code |
| `specialty` | Specialty or organisation type |
| `page`, `per_page` | Paging (`per_page` ≤ 50, default 20) |
| `cursor` | Next page, for registries that use cursor paging |

Unknown parameters and filters a registry cannot apply are rejected with `400` and a list of what
that registry supports.

Response:

```json
{"source":"gb-nhs-ods","country":"GB","page":1,"per_page":20,"total":31,"has_more":true,"next_cursor":null,
 "count":20,"items":[{"id":"gb-nhs-ods:RJ1","name":"Guy's And St Thomas' NHS Foundation Trust",
 "category":"NHS Trust","specialties":["NHS Trust"],"status":"active",
 "address":{"line1":null,"line2":null,"city":null,"region":null,"postal_code":"SE1 7EH","country_code":"GB"},
 "phone":null,"email":null,"website":null,"identifiers":[{"system":"ODS","value":"RJ1"}],
 "updated_at":"2023-11-14","source_url":"https://directory.spineservices.nhs.uk/ORD/2-0-0/organisations/RJ1"}]}
```

Search results carry fewer fields than `/facilities/:source/:id`, which adds the full address,
phone and website where the registry has them. Records never include coordinates, because the
directory does not draw facility pins.

## Connected national registries

| Source id | Country | Registry | Key | Filters | Verified |
| --- | --- | --- | --- | --- | --- |
| `us-nppes` | US | CMS **NPPES NPI Registry** API v2.1 (organizations, NPI-2) | none | name, city, region (state), postal_code, specialty (taxonomy) | **Live**, from this environment and the local Worker runtime |
| `gb-nhs-ods` | GB | NHS England **Organisation Data Service** (ORD 2-0-0) | none | name, postal_code, specialty (ODS organisation type) | **Live**, including a browser test through the Worker |
| `fr-annuaire-sante` | FR | ANS **Annuaire Santé** — API FHIR v2 (`Organization`) | `ESANTE_API_KEY` | name, city, postal_code | Implemented to the published FHIR spec and tested with fixtures. Live calls need the key (the ANS gateway refused this sandbox's IP). |
| `co-reps` | CO | Colombia **REPS** official Socrata registry | none | name, city, region (two-digit DANE department), specialty (provider class) | Verified with live Socrata queries; results reflect source's published snapshot, not real-time licensing status. |
| `mx-inegi` | MX | Mexico **INEGI DENUE** official token-based API `BuscarAreaAct` (health/social-assistance sector 62) | `INEGI_DENUE_TOKEN` | name, region (state code 01–32), specialty (subsectors 621–624) | Official API integration; live Cloudflare requests must be verified after deployment. |

Registry quirks handled in code:

* NPPES ignores a city or state on its own, so a name, postal code or specialty is required.
* NPPES name search matches the start of the organisation name.
* ODS rejects `Offset=0`, so the offset is omitted on page 1.
* ODS "specialty" is matched to its organisation-type catalogue (e.g. "pharmacy", "NHS trust").
* Annuaire Santé pages with FHIR `next` links. These are returned as an opaque `next_cursor` and
  only ever followed back to the ANS gateway.

Other countries return `404 no_registry` with the list of supported countries. There is no fallback
to non-registry data.

## Secrets: which keys, and where to enter them

| Secret name | Needed for | How to get it |
| --- | --- | --- |
| `ESANTE_API_KEY` | France (`fr-annuaire-sante`) | Free. Create an account at <https://portal.api.esante.gouv.fr> (Gravitee), create an application, subscribe it to **"API Annuaire Santé en libre accès"**, then copy the API key shown under *Applications → Souscriptions*. |
| `INEGI_DENUE_TOKEN` | Mexico (`mx-inegi`) | Issued by INEGI from <https://www.inegi.org.mx/servicios/api-denue/>; stored only as a Cloudflare Worker binding, never in GitHub code or browser requests. |

US NPPES, NHS ODS, and Colombia REPS need **no keys**. Mexico requires the `INEGI_DENUE_TOKEN` Cloudflare Worker binding.

Enter the secret in one of two ways:

* **Dashboard:** Cloudflare → *Workers & Pages* → `healthcare-directory-api` → *Settings* →
  *Variables and Secrets* → **Add** → Type **Secret**, name `ESANTE_API_KEY`, paste the key → *Deploy*.
* **CLI:** from `worker/`, run `npx wrangler secret put ESANTE_API_KEY` and paste when prompted.

`FRONTEND_ORIGIN` is already set in Cloudflare. It may hold several comma-separated origins.
`wrangler.toml` sets `keep_vars = true`, so a deploy does not remove it.

## Security

* GET, HEAD and OPTIONS only. Anything else returns `405`.
* CORS echoes only origins listed in `FRONTEND_ORIGIN`.
* Every query parameter is validated: allowed names only, length limits, a character allow-list,
  and bounded paging.
* Rate limit: 60 requests per minute per client IP, per Worker isolate. This is best-effort on the
  free tier and returns `429` with `Retry-After`.
* Outbound requests are HTTPS GET only, to fixed registry hosts, with an 8 s timeout, a 4 MB response
  cap and redirects disabled.
* Secrets are sent only in the registry's request header. They are never in responses, and log lines
  are scrubbed.
* Registry failures map to `502`, `503` or `504` with generic messages.
* Successful responses are cached for 5 minutes.

## Develop and test

```bash
npm test                                   # includes tests/worker.test.mjs (fixtures, no network)
cd worker && npx wrangler dev --port 8787 --var FRONTEND_ORIGIN:http://127.0.0.1:4173
# browser test through the local Worker (real workerd + live NHS ODS):
npm run build && E2E_PORT=4173 REGISTRY_WORKER_URL=http://127.0.0.1:8787 npm run test:e2e
```

## Deploy (only after approval)

```bash
cd worker && npx wrangler deploy
```

This updates the existing `healthcare-directory-api` modules in place. The Static Site reads
the Worker URL from `assets/js/world-config.js` (`REGISTRY_API_URL`).

Deploy the Worker **before or together with** the Static Site change. The existing API routes and source adapters for the U.S., UK, and France must remain intact.

**Mexico origin:** The public INEGI ArcGIS FeatureServer previously returned HTTP 526 from Cloudflare. Mexico now uses the separate official DENUE API on `www.inegi.org.mx` with `INEGI_DENUE_TOKEN`, filtering to SCIAN sector 62. No per-facility coordinate pins, Neon imports, viewer exports, or downloads are introduced.
