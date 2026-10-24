# Healthcare Facility Map

A U.S. state → county map with healthcare facilities stored in **Neon PostgreSQL**, not in hardcoded JavaScript or bundled CSV files. There are **no preloaded facility records**. Geographic TopoJSON comes from the existing licensed us-atlas map asset; all facility and category records come from the database.

## Database

The new **HEALTHCARE_DIRECTORY** Neon project has an empty `public.healthcare_facilities` table created with `scripts/healthcare_schema.sql`. The older Neon project is separate and untouched.

Set these **private server environment variables** in the hosting provider's environment configuration (not in GitHub, a browser script, or the app URL):

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Neon **pooled** PostgreSQL connection URL, including `sslmode=require`; get a freshly rotated credential from Neon |
| `IMPORT_TOKEN` | Strong random 32+ character bearer token required for imports; generate with `openssl rand -hex 32` |
| `PORT` | Optional application port; defaults to 3000 |

Run `npm install` then `npm start`. `/healthz` executes `SELECT 1` against Neon and returns HTTP 200 only if the database answers. **Without `DATABASE_URL`, the map page still loads but database API endpoints return HTTP 503 instead of fabricating records.** Do not put the connection URL or `IMPORT_TOKEN` in tracked files, and do not expose them as client-side environment variables.

## Upload data

Open `/admin` after deploying. Select a UTF-8 `.csv` or JSON file and enter your private `IMPORT_TOKEN`. The browser sends the file to the server over HTTPS; the server validates it and performs an atomic PostgreSQL upsert. The token is not saved to local storage. A downloadable blank CSV header template is provided in the page. Maximum **5,000 records or 8 MB** per browser upload.

Required fields:

- `source_name`: Source/system identifier, e.g. an official registry name
- `source_record_id`: Stable ID assigned by the source (unique together with `source_name`)
- `name`: Facility name
- `category`: Lowercase slug, e.g. `hospital`, `clinic`, `dental`, `urgent-care`, `laboratory`, `imaging`, `pharmacy`; new categories may be added in uploads without code changes
- `county_fips`: Exactly five digits, e.g. `06019` (preserve the leading zero in spreadsheet exports)

Optional fields: `address`, `city`, `state`, `postal_code`, `phone`, `email`, `website`, `latitude`, `longitude`, `source_url`, `metadata` (JSON object). When you provide coordinates, provide both latitude and longitude in decimal degrees. Uploads with repeated `source_name + source_record_id` **update** existing records instead of duplicating them. The import validates the complete file before its database transaction and rolls back if a query fails.

CLI alternative (same validation and upsert):

```bash
npm run import:facilities -- /path/to/your/real_facilities.csv --dry-run
npm run import:facilities -- /path/to/your/real_facilities.csv
```

The second command requires `DATABASE_URL` in the process environment; the dry run does not. Do not commit CSVs containing private data or patient records to the repository. This project is designed for **facility directory information**, not PHI.

## API

- `GET /api/healthcare/categories`: categories and counts derived from the database.
- `GET /api/healthcare/county/:fips?category=clinic&page=1&per_page=100`: paginated facility results. Page size 1–250, default 100.
- `POST /api/admin/facilities/import`: CSV or JSON array, protected by `Authorization: Bearer <IMPORT_TOKEN>`.
- `GET /healthz`: live DB connectivity check.

All SQL is parameterized; there are no hardcoded facility records or legacy procurement endpoints. The map's us-atlas geometry is projected with `d3.geoAlbersUsa().scale(1300).translate([487.5,305])` for optional facility pins. The map and API work with **zero records** and explicitly show an empty-directory message until records are imported.

## Verification and deployment notes

Run `npm test` (Node 22+) for API, CSV parsing, validation, authentication, pagination and transaction regression tests. The Neon schema and empty state can be verified with `SELECT count(*) FROM healthcare_facilities;`. A live host must receive `DATABASE_URL` and `IMPORT_TOKEN` in its **private** environment settings; GitHub repository code alone cannot inject private variables into Render or another host. The original connection password shared in chat should be rotated in Neon before production deployment.
