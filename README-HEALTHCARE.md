# Healthcare Facility Map (migration branch)

This is a map-only healthcare directory prototype. The app preserves geographic state and county boundaries. It does **not** connect to Neon or any database.

## Current data status

The endpoint `GET /api/healthcare/county/:fips` returns an empty `facilities` array with `data_status: "not_configured"` until an independent healthcare data source is integrated. No healthcare facilities are fabricated. The Neon project and its data are **not modified or deleted**.

## Cleanup status

The active server no longer imports `pg`, reads `DIRECTORY_DATABASE`, connects to Neon, or serves the former procurement database routes. Legacy source files, workflows, schemas and hardcoded datasets still require repository cleanup and dependency review. They are not used by the new app entry point.

## Quality checks

Run `npm test` and check state/county navigation and responsive layout in a browser. No live deployment is claimed.
