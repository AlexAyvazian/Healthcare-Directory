# Contact enrichment (Singapore, Taiwan)

The Network Map country registries in Neon ("Singapore - Registry", "Taiwan - Registry") are the
shared source for the Network Map and this Directory. The Directory reads them read-only.

`official_registry_providers` is truncated and reloaded on every registry refresh, so enriched
contacts are never written there. They live in separate tables keyed by `source_record_id`
(no foreign key), created by `001_contact_tables.sql`:

| Table | Holds |
|---|---|
| `official_registry_contact_emails` | One row per facility + address, with `purposes`, `source_status`, `match_basis`, name/postal snapshots |
| `official_registry_contact_email_evidence` | One row per public page that shows the address |
| `official_registry_contact_points` | Websites, phones, faxes, contact forms |
| `official_registry_contact_point_evidence` | Evidence for each contact point |
| `official_registry_providers_with_contacts` (view) | Providers plus `enriched_emails` and `enriched_contacts` |

The table and column names follow the Argentina registry so the same reader works for every country.

## Rules

- Only addresses literally published on a public page or official dataset. Nothing is guessed,
  completed or corrected (malformed source values are skipped, not fixed).
- A facility keeps every supported address, each tagged with what it is for.
- `delivery_verified` stays `false`; nothing has been sent to these addresses.
- `source_status`: `official_published` (shown), `historical_published` (old but documented, shown as
  historical), `candidate_unreviewed` (hidden from the view until reviewed).
- A match needs the facility's postal code and name, plus the unit number or phone where available.
  Postal-code-only matches are rejected, because they were often a different or successor clinic.

## Sources used

Singapore
- MSF "Baby Bonus - Approved Institutions" dataset on data.gov.sg (`d_2509dfdb3d6b87606fe909dd72fbb9fb`).
- Great Eastern $13 GP consultation participating-clinic lists (2024-11, 2024-12, 2026-09).
- Clinic group location pages, for per-outlet addresses or group addresses where the group lists the
  outlet's postal code.

Taiwan
- City and county health bureau station lists and health station sites.
- Hospital and care-home websites, and Tainan City Government pages.
