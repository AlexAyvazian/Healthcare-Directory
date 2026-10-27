# Healthcare Facility Map

Two separate, view-only geographic directories on one static site:

* **United States** (`/`): the existing state → county map backed by the `HEALTHCARE_DIRECTORY` Neon project.
* **International** (`/world.html`): world → country → province/state/region drill-down backed by the
  separate `WORLD_HEALTHCARE_DIRECTORY` Neon project. Regions are the only selectable objects (no
  facility pins); facilities appear in the scrollable sidebar. See
  [docs/INTERNATIONAL_DIRECTORY.md](docs/INTERNATIONAL_DIRECTORY.md) for geography sources, the pinned
  Canada boundary file, country colours, database security, tests, and known limitations.

## Render Static Site

This repository now builds a **static front end** for the Render CDN. **No Render Web Service, Cloudflare Worker, or server cold start is required for the website shell.**

Render settings:
- **Repository:** `AlexAyvazian/Healthcare-Directory`
- **Branch:** `main`
- **Build command:** `npm run build`
- **Publish directory:** `dist`
- **Root directory:** blank

The build script explicitly copies only approved public files into `dist`. Never publish the repository root: it includes Node source and importer utilities.

## Healthcare records

Facility data is served from the **Neon Data API** over HTTPS (not hardcoded in JavaScript). The browser accesses only public, read-only fields from `healthcare_facilities`, protected by Postgres RLS; categories come from the read-only `facility_category_counts` view. No SQL connection string, database owner password, management API key, or import bearer token belongs in static files. The API base URL in `assets/js/neon-data.js` is a **public endpoint**, not a secret.

The new Neon HEALTHCARE_DIRECTORY project has no imported facility records yet, so the map shows an empty state until you add them. The static site still loads when Neon is idle; the first facility query may pause while the free database wakes.

### Private facility imports only

**Public viewers cannot upload, export, or download directory data through the website.**
The public Render Static Site includes **no upload forms, administrator page, CSV download,
or export button**. The deployed `dist` includes only the map and read-only facilities
viewer; `admin.html` and the old browser upload script have been removed from the repository.

For administrator-only bulk imports, use the command-line importer on a trusted computer,
private CI job, or similarly restricted environment. It does **not** run in the public viewer:

```bash
npm run import:facilities -- /path/to/facilities.csv --dry-run
npm run import:facilities -- /path/to/facilities.csv
```

Set the private `DATABASE_URL` only in that environment. Do not expose PostgreSQL credentials,
Neon management API keys, or import tokens to browsers, Render static assets, or GitHub files.
Rotate the database owner password previously pasted into chat.

**Important:** Since directory records are publicly visible through the read-only Neon Data
API, a technically capable visitor can still manually copy displayed information or query
the public API. Removing buttons is **not** a prevention mechanism for extracting public
records. Truly preventing retrieval requires authenticated access control and limiting
who can view the data.

## Facility logos

Both sidebars read saved logos through the Cloudflare Worker. Brand identity, facility mappings,
lookup history, and saved Logo.dev PNGs live in two dedicated Neon logo projects, separate from
the healthcare records. Initial enrichment runs independently of sidebar reads; successful matches
and misses are retained. See [the architecture and operating guide](docs/LOGO_ARCHITECTURE.md).

## Node backend

The existing Node backend remains in `server/` for private/local deployments. Render static hosting does **not** execute it, and the public map no longer calls its `/api/healthcare` endpoints.

Run `npm test` and `npm run build` locally or rely on the GitHub verification workflow.
`npm run build` downloads the bundled geoBoundaries files (≈92 MB, including Canada's original
26,022,306-byte file) and fails if any byte count or SHA-256 differs from the pinned values.
Browser tests: `npm run build && npm run test:e2e` (requires Playwright with Chromium).
