# 04 – API resources

*PLAN.md §8*

Every route sits under **`/solar/v1.0`**: a feature name plus a major.minor version (G §5.4-5.5). Path segments and query parameter names are lowercase and hyphenated; JSON fields are snake_case. Collections are plural nouns and no URI contains a verb.

## Read routes: analysts only, always filtered to the caller's area

| Path | Type (G §4) | Returns |
|---|---|---|
| `/provinces` | collection | Provinces the caller can see |
| `/provinces/{province-id}` | atomic | One province |
| `/provinces/{province-id}/districts` | scoped collection | Districts in that province |
| `/districts` | collection | Visible districts |
| `/districts/{district-id}` | atomic | One district |
| `/districts/{district-id}/grid-substations` | scoped collection | Substations in that district |
| `/grid-substations` | collection | Visible substations (filterable) |
| `/grid-substations/{substation-id}` | atomic | One substation |
| `/grid-substations/{substation-id}/installations` | scoped collection | Installations on that substation |
| `/installations` | collection | Installation directory (filterable) |
| `/installations/{installation-id}` | atomic | One installation's metadata (also readable by the provisioning service) |
| `/installations/{installation-id}/overview` | composite | Installation + substation + district + province + latest reading (or `null`) |
| `/installations/{installation-id}/last-known-reading` | derived | Most recent reading by observation time, or 404 if none |
| `/installations/{installation-id}/readings` | scoped collection | That site's history: filters, sort, paging |
| `/installations/{installation-id}/readings/{reading-id}` | atomic | One reading; both ids must match |
| `/readings` | collection | Readings across sites, filtered by area and time window |
| `/district-generation-summary?district-id=` | processing (derived) | District totals; see [07](07-district-summary.md). **Changed:** planned as `/districts/{district-id}/generation-summary` |

**Why `/readings` exists as well as the per-site history:** B §6 asks a separate analytical question (how generation behaved across a region). G §3 says client needs shape the resource model ("clients win over data"), so a resource does not have to be a single entity. Devices cannot use either read collection.

**The overview stays bounded:** it embeds one latest reading, never the whole history.

## Device ingestion

| Method and path | Who | Success |
|---|---|---|
| POST `/installations/{installation-id}/readings` | Device token whose subject is this installation, scope `installation-write` | 201 + `Location`, `Content-Location`, `ETag`, `Last-Modified` |

```json
{
  "timestamp": "2026-10-07T06:00:00Z",
  "power_kw": 3.25,
  "cumulative_energy_kwh": 1524.80,
  "voltage_v": 230.40
}
```

- The server assigns `id`, `installation_id` and `received_at`. A body that sends these, or any unknown field, is rejected (400).
- The insert is committed before 201 is returned.
- A device cannot GET the `Location` it gets back (write-only by design); an analyst in that area can.
- Same installation + same timestamp → **409**, even if the values differ. History is never overwritten. The unique constraint makes concurrent retries safe: six identical POSTs at once gave one 201 and five 409s.

## Installation metadata (provisioning service only)

This is the plan's answer to Q1 (see [01](01-overview.md)).

| Method and path | Behaviour |
|---|---|
| POST `/grid-substations/{substation-id}/installations` | Create an installation on a known substation → 201 + `Location` |
| GET `/installations/{installation-id}` | Read metadata (no readings embedded) |
| PUT `/installations/{installation-id}` | Replace the **complete** editable representation: `substation_id`, `meter_id`, `label`, `capacity_kw`, `commissioned_on`, `active`. Missing field → 400. Unknown id → 404 (PUT never creates). A no-op keeps the same ETag |
| DELETE `/installations/{installation-id}` | Only if the site has no readings, otherwise 409. Planned as 200 + body; **Changed:** built as 204 |

- PUT and DELETE require `If-Match`: missing → 403 (code 1021), stale → 412.
- An installation with history cannot change its meter id or parent substation (409), because that would rewrite past regional reports.
- A temporary unseeded site is used for CRUD demonstrations, so the seed data is never destroyed.

## Readings cannot be changed

PUT, PATCH or DELETE on a reading → **405** with `Allow: GET, HEAD`, after authentication. No PATCH was added just to increase the endpoint count.

## Public routes

| Path | Purpose |
|---|---|
| `/docs` | Swagger UI, the only browser interface |
| `/openapi.json` | The contract, including the JWT scheme |
| `/health/live` | Process is up; reveals nothing |
| `/health/ready` | 200 if the database answers, otherwise 503 |
