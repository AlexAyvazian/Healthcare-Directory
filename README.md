# Healthcare Facility Map

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

## Node backend

The existing Node backend remains in `server/` for private/local deployments. Render static hosting does **not** execute it, and the public map no longer calls its `/api/healthcare` endpoints.

Run `npm test` and `npm run build` locally or rely on the GitHub verification workflow.
