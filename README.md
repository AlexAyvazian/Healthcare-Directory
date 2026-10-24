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

### Imports

The previous `/api/admin/facilities/import` Node endpoint **cannot run** on Render static hosting. **Browser uploads are currently disabled** pending Neon Auth administrator sign-in and restrictive write RLS policies. `/admin.html` explains the secure temporary import workflow, and includes a CSV template.

Until browser admin auth is deployed, use a trusted computer or secure scheduled job to run:

```bash
npm run import:facilities -- /path/to/facilities.csv --dry-run
npm run import:facilities -- /path/to/facilities.csv
```

The importer requires `DATABASE_URL` set **privately in the terminal or runner environment**. Do not add it to Render Static Site environment variables, because build-time variables can be compiled into public assets. Do not upload PHI. The database owner password previously shared in chat should be rotated.

## Node backend

The existing Node backend remains in `server/` for private/local deployments. Render static hosting does **not** execute it, and the public map no longer calls its `/api/healthcare` endpoints.

Run `npm test` and `npm run build` locally or rely on the GitHub verification workflow.
