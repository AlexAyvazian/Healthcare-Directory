# International Healthcare Directory

The International Directory (`/world.html`) is the world-scale sibling of the U.S. map at `/`.
It is a **geographic directory, not a pin map**: countries and administrative regions are the only
selectable map objects, and healthcare facilities appear in the scrollable sidebar.

```
World ─▶ Country ─▶ first-level region ─▶ deeper regions (where geoBoundaries publishes them)
          e.g. Canada ─▶ British Columbia ─▶ census divisions
               Mexico ─▶ Jalisco ─▶ municipalities
               Germany ─▶ federal state ─▶ government district ─▶ district
```

Both directories are static files on the existing Render Static Site (`npm run build` → `dist`).
There is no server, Worker, or new paid service.

## 1. Recovery record (what existed before this change)

| Item | State found on 2026-10-24 |
| --- | --- |
| GitHub `main` | `cba4bd6` (U.S. map only). No international frontend in any branch. The earlier Work session's frontend was never pushed and could not be recovered. |
| Historical design | Recovered from `4a0d5f1`: `data/county-employee-intelligence-map-TRUE-MAP.html` (`renderUSMap`, `renderStateMap`, `renderSideList`, `openRecord`), `…OLD-DESIGN-RESTORED(1).html` (`openDrawer`), `assets/css/map.css`, `assets/css/directory.css`. **Only styling and interaction patterns were reused; no historical contact data.** |
| World Neon (`WORLD_HEALTHCARE_DIRECTORY`, `purple-queen-31542565`) | Dev branch `feature-global-directory` (`br-old-cake-b5b6ncm4`) already contains `directory_private.facilities`, the `directory.facilities` and `directory.category_counts` views, the `world_directory_reader` role, RLS policies, and an active Data API. Reused unchanged. **No database changes were made.** |
| Canada boundary | The original file and its digest were not in the exported logs. They were re-established from the authoritative source (see §3). |

## 2. Files

| File | Purpose |
| --- | --- |
| `world.html`, `assets/css/world.css` | Page and styles: glass panels, orbs, cursor glow, luminous borders, floating record drawer (recovered design). |
| `assets/js/world-map.js` | D3 map controller: world → country → regions, fly-to transitions, breadcrumbs, Back/Escape, browser history (`#/CAN/…`), sidebar, drawer. |
| `assets/js/world-data.js` | Read-only Neon Data API client (anonymous session token, GET only, paginated). |
| `assets/js/world-geo.js` | Progressive boundary loading with in-browser size + SHA-256 verification and per-session caching. |
| `assets/js/world-colors.js` | Country colour states and derived subdivision shades. |
| `assets/js/world-catalog.js` | **Generated** explicit ISO registry: names, codes, colour table, pinned geoBoundaries sources. |
| `assets/js/world-config.js` | Public endpoints and the list of boundary files bundled into the site. |
| `assets/vendor/world-atlas-countries-50m.json` | world-atlas 2.0.2 country outlines (Natural Earth 1:50m, ISC licence). |
| `scripts/build-static.mjs` | Copies the public allowlist and the hash-verified boundary files into `dist`. |
| `scripts/generate-world-catalog.mjs` | Maintenance tool that regenerates the catalog (never part of the build). |
| `index.html` | **Only change to the U.S. map:** one `International directory` link in the top bar. |

## 3. Geography

* **Country outlines:** world-atlas `countries-50m.json`, loaded once (≈0.75 MB).
* **Subdivisions:** geoBoundaries gbOpen *simplified* GeoJSON, **exactly as published**, pinned to commit
  [`5c25134028196d43ce97b5071934fd0cfc92f09f`](https://github.com/wmgeolab/geoBoundaries/tree/5c25134028196d43ce97b5071934fd0cfc92f09f/releaseData/gbOpen).
  Each file's byte size and SHA-256 come from its Git LFS pointer at that commit.
* **Progressive loading:** nothing below country level is downloaded until a country is selected; the
  next level loads when a region is selected. Files are cached for the session.
* **Bundled files** (copied into `dist/geo/gbOpen/…` at build time): CAN ADM1–2, MEX ADM1–2, DEU ADM1–3,
  GBR ADM1–2, AUS ADM1–2 (≈92 MB). All other countries load on demand from the pinned commit on
  `media.githubusercontent.com` and are verified against the same digests in the browser.
* **Any size or checksum mismatch fails the build** (bundled files) or shows an error with retry
  (on-demand files). No other geometry is ever substituted.

### Canada (strict no-modification rule)

| | |
| --- | --- |
| Source | `releaseData/gbOpen/CAN/ADM1/geoBoundaries-CAN-ADM1_simplified.geojson` (Statistics Canada, Open Government Licence – Canada) |
| Size | **26,022,306 bytes** |
| SHA-256 | `0c9e4fc56c8b9ce958960ffabd1556fbe7c3ec0deeea346a2b5b7dff05e35449` (equals the Git LFS object id) |
| Verified | at build (size + hash, then re-hashed after copying into `dist`), in the browser before use, and by `tests/static.test.mjs` |

The file is never simplified, re-projected, rewritten, or replaced. The only in-memory preparation for
rendering is reversing ring order when a polygon is wound opposite to d3's spherical convention
(RFC 7946 sources are counter-clockwise). No vertices are added, moved, or removed, and the file on
disk and on the wire is untouched.

### Hierarchy and coverage

* Levels come from the geoBoundaries files that exist for each country (ADM1–ADM3), so depth varies by
  country: 21 countries have one level, 102 have two, and 73 have three. A level that only republishes
  the previous one is skipped (for example, GBR ADM3 is a 2020 re-release of the ADM2 units).
* geoBoundaries does not store parent ids. A child region is placed in the parent whose polygon
  contains its centroid (falling back to sample vertices, then the largest bounding-box overlap).
* **No subdivision boundaries are published** for these 39 territories. Selecting one shows national
  records and says so, without inventing shapes: Aruba, Anguilla, Åland Islands, American Samoa,
  Antarctica, French Southern Territories, Saint Barthélemy, Bermuda, Cook Islands, Curaçao,
  Cayman Islands, Western Sahara, Falkland Islands, Faroe Islands, Guernsey, Guam, Hong Kong,
  Heard & McDonald Islands, Isle of Man, British Indian Ocean Territory, Jersey, Macao, Saint Martin,
  Northern Mariana Islands, Montserrat, New Caledonia, Norfolk Island, Pitcairn Islands, Puerto Rico,
  French Polynesia, South Georgia & South Sandwich Islands, Saint Helena, Saint Pierre & Miquelon,
  Sint Maarten, Turks & Caicos, Holy See, British Virgin Islands, U.S. Virgin Islands, Wallis & Futuna.
* Four Natural Earth shapes have no ISO 3166 code (Northern Cyprus, Somaliland, Indian Ocean
  Territories, Siachen Glacier). They are drawn and coloured, but are not part of the directory.
* The United States is drawn in muted grey (`#4A5363`), uses no palette colour, and opens `/`.
  No U.S. geometry beyond the world outline is loaded here.

## 4. Country colours

* The palette is the user's 9×9 screenshot (blues, teals, greens, yellows/golds, oranges, reds, pinks,
  purples, dark neutrals). Hex values were sampled from the PNG embedded in the reference dossier using
  each chip's **most common** colour, which ignores the watermark. 80 of 81 match the dossier's table;
  purple #6 samples as `#81298F` rather than the dossier's watermark-affected `#893F97`. **The
  screenshot remains the authority. These values are a careful sampling, not a claim of exact
  reproduction.**
* Colours follow an explicit **single geographic itinerary** in `scripts/world-country-order.mjs`,
  beginning Canada → Mexico → Guatemala → Belize → Honduras → El Salvador → Nicaragua → Costa Rica →
  Panama → Colombia → Ecuador → Peru, then South America, the Caribbean, Europe, Africa, Asia and
  Oceania. That route is fixed, reviewed in source, and independently regression-tested.
* **The first nine countries use blue shades 1–9 in order, with no skipping.** Additional blue
  shades are derived and used immediately afterward as one continuous geographic blue block. Only
  then does teal start, followed by green, yellow, orange, red, pink, purple and neutral. Each family
  appears exactly once as a continuous geographic block. Unique intermediate shades accommodate all
  239 country/territory entries. None of the blue shades reappear later in a different continent.
* A country's colour is assigned by its position in the itinerary. Color-distance optimization,
  previous incorrect assignments, and nearest-centroid heuristics never override this order.
  All hover/selected/outline/glow states are derived from each country's own assigned color.
  Tests reject out-of-order shade assignments or scattered color families.
* Each country has `fill`, `hover`, `selected`, `outline`, `glow` and `accent` states. Its subdivisions
  shade from the country colour toward its family's `accent`, keeping a shared lighting identity. A
  selected region turns bright and glows in the country's glow colour.
* Re-running the generator **preserves every existing assignment**. New countries only take unused
  swatches. A snapshot test fails if any country's colour changes.

## 5. Database and API security

**Endpoints (public, not credentials):**

* Data API: `https://ep-old-pine-b5jgsksc.apirest.c-7.us-east-2.aws.neon.tech/neondb/rest/v1`.
  Exposed schema: `directory` only. Anonymous role: `anonymous`. Max rows: 101.
* Neon Auth: `https://ep-old-pine-b5jgsksc.neonauth.c-7.us-east-2.aws.neon.tech/neondb/auth`.
  The Data API rejects requests that carry no JWT. The viewer therefore fetches a short-lived
  *anonymous* token (`GET /token/anonymous`, `role: anonymous`, 1 h) and sends it as a Bearer
  token. No sign-in, cookie, or secret is involved.

**Verified on the dev branch (read-only inspection plus non-mutating requests):**

* `anonymous` is a member of `world_directory_reader`. That role has `SELECT` on the two `directory`
  views and **column-level** `SELECT` only on published columns of `directory_private.facilities`. It
  has no access to `metadata`, `latitude`, `longitude`, `source_record_id`, `created_at` or
  `updated_at`.
* `anonymous` has no `INSERT`/`UPDATE`/`DELETE` on the views or the table. An empty-array `POST` and a
  `DELETE` matching no rows both return `42501 permission denied`.
* RLS is enabled **and forced** on `directory_private.facilities`. `public_read_published` allows only
  `published AND country_iso3 <> 'USA'`. The views are `security_invoker`/`security_barrier`.
* `Accept-Profile: directory_private` does not expose the private table; selecting `metadata` fails.
* CORS: `access-control-allow-origin: *`; `Content-Range` is exposed for counts.
* The viewer selects only these fields: `id, country_iso3, country_iso2, admin_path, admin_names,
  name, category, address, city, postal_code, phone, email, website, source_name, source_url,
  source_retrieved_at`. It never selects `search_document`.
* At the time of writing there are **0 published facilities**. The live site shows true empty
  states, and no synthetic records were written anywhere.

**Region matching (convention for private importers).** A facility appears under a region when
`admin_path` contains one of that region's codes, or `admin_names` contains its name and all
ancestor names:

* `admin_path`: ISO 3166-2 code for the first level when the source has one (e.g. `CA-BC`), otherwise
  the geoBoundaries `shapeID`. Use `shapeID` for deeper levels. Quebec's source code is `CA-QB`, so
  name matching (or adding both codes) covers it.
* `admin_names`: region names from the top level down, e.g. `{"British Columbia","Kootenay"}`.

## 6. Tests

```bash
npm test              # unit + build/static tests (node:test)
npm run build         # Render build; downloads and verifies the bundled boundary files
npm run test:e2e      # Playwright/Chromium browser scenarios against dist/ (needs Playwright installed)
```

Browser scenarios use the real empty database (**LIVE**) or intercept the Data API with synthetic,
clearly labelled records from `tests/fixtures/world-facilities.fixture.mjs` (**FIXTURE**). Fixture
records are never written to Neon. Screenshots are in `docs/evidence/`.

## 7. Known limitations and decisions for the owner

1. **The U.S. Data API currently rejects anonymous requests** (`400 … required authorization bearer
   token in JWT format`, verified 2026-10-24). The U.S. sidebar therefore cannot load records,
   although its map works. This predates this change and was **not** altered, because the U.S. map
   and database are out of scope without approval. The same anonymous-token approach used here would
   fix it.
2. The site points at the **development** branch of `WORLD_HEALTHCARE_DIRECTORY`. The production
   branch has no Data API or Neon Auth yet. Promoting either requires owner approval.
3. The Neon Auth anonymous-token endpoint currently answers any `Origin` (no trusted domains
   configured). It only issues read-only anonymous tokens, but restricting it to the Render domain
   is recommended.
4. Non-bundled countries depend on `media.githubusercontent.com` at view time. Their bytes are
   hash-verified. To remove the dependency, add more entries to `BUNDLED_GEO`.
5. Large files load with a progress bar: Canada ADM1 26 MB (accepted), Canada ADM2 18 MB, Mexico
   ADM2 17 MB.
6. Tiny island states are hard to click on the world view. The searchable country list in the sidebar
   reaches every country by mouse or keyboard.
7. The Playwright suite is not part of the GitHub workflow, because it needs a browser install.
   It was run locally (see the PR).
8. Database credentials pasted in earlier conversations should be rotated by the owner.
