# 10 – Testing and evidence

*PLAN.md §17-18*

## OpenAPI first

The contract is designed before the routes. Every operation documents its id, tag, parameters and defaults, request and response schemas, the JWT requirement with its scope and area rules, every success and error status with headers, and examples. There are examples for empty pages, 401, 201 + `Location`, 304 and 412.

The bearer scheme in OpenAPI does **not** enforce scopes itself; the API does, and tests prove it. There is one source file (`openapi/openapi.yaml`), served live as `/openapi.json`. Tests validate the spec, compare the real route list against the documented operations, and check real responses against the documented schemas.

## Test groups

| ID | Group | Must show |
|---|---|---|
| T01 | Data invariants | Foreign keys, six entities, unique meters, reading ownership, duplicate timestamps |
| T02 | Hierarchy | Every collection, item and nested route returns the right scoped data; mismatched paths fail |
| T03 | Ingestion | Own device → 201 + headers; analyst can GET the `Location`; other device and analysts denied |
| T04 | History | `from` inclusive / `to` exclusive, both sort orders, tie-breaks, count and links, offset past the end |
| T05 | Regional | Province, district, substation and time filters intersect correctly; totals scoped in SQL |
| T06 | Composite / latest | Bounded overview, `null` latest where right, latest by observation time despite late arrivals |
| T07 | Conditional reads | 200 → 304 with empty body; change → 200; scope changes; ETag beats date |
| T08 | Metadata CRUD | Service principal only; complete PUT; 412 race; delete keeps history safe |
| T09 | JWT + authorization | Bad signature, alg, expiry, issuer/audience; wrong principal; revoked user; cross-area ids, counts, 304s |
| T10 | Errors / negotiation | 400 401 403 404 405 406 409 412 413 415; one error schema; `Allow`, `WWW-Authenticate` |
| T11 | Summary maths | Hand-calculated power and register differences; midnight, stale, missing, reset, boundary gaps |
| T12 | Seed | ≥ 134,400 readings; ≥ 7 days per site; 9/25/30/200; no orphans |
| T13 | Deployment | Live HTTPS, Swagger assets and login, data survives redeploy, clean-checkout setup |
| T14 | OpenAPI | Valid spec, every operation covered, schema/status/header parity |
| T15 | Performance / faults | Indexed seeded queries, bounded payloads, concurrent inserts, database failure handling |

**Why real PostgreSQL:** unit tests alone cannot prove that SQL queries are scoped. Ownership, counts, filters, uniqueness and transactions are tested against a real database, running the API as the least-privilege `solar_api` role.

## Results (actual runs)

| Check | Result | When |
|---|---|---|
| `npx vitest run` (unit + integration) | 21 files, **208 tests passed**, exit code 0 | 2026-10-10 |
| `npm run smoke` against production | **19/19** passed | 2026-10-10 |
| `npm run db:verify` on production | All checks **PASS** (154,891 readings) | 2026-10-10 |

Read the "Tests" line, not just the exit code. An embedded-postgres hook once made failing runs exit 0 (fixed in `6d4cf45`), and a `TypeError: done is not a function` from its teardown still prints after the summary.

## Evidence rules

- Record command, time, environment and commit for every result. Never record a result that was not actually run.
- Redact `Authorization` headers, credential URLs and personal data.
- For each feature: one normal case plus the important failure and edge cases.
- Screenshots supplement real responses. They do not prove authorization or maths by themselves.

Evidence screenshots: `report-figures/screenshots/` (26 images, local only).
