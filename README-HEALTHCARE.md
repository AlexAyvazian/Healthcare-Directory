# Healthcare Facility Map (migration branch)

This branch introduces a **map-only healthcare directory** prototype. The old employee directory and procurement interfaces are not loaded by the new app shell. The county employee datasets and existing database tables are **not erased** on this branch.

## Geographic navigation

Click a U.S. state, then a county. The county selection requests `GET /api/healthcare/county/:fips`, with optional `?category=` filter. Facilities have validated county FIPS and optional WGS84 latitude/longitude pins. No government employee records are returned.

## Data model

A dedicated `healthcare_facilities` table stores `id, county_fips, name, category, address, phone, website, latitude, longitude`. Create the table with `scripts/healthcare_schema.sql`. An empty table produces an honest empty result, not fabricated healthcare facilities.

This migration intentionally leaves existing procurement datasets and Neon database untouched; database deletion must be handled separately after verified backup and source identification.

## Quality checks

Run `npm test`. Verify state/county click, empty counties, data-loaded counties, category filter, geographic pins, and mobile layout against a running server.
