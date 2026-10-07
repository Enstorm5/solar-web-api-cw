# SLSEA Solar Generation API

Backend REST API (NB6007CEM coursework) for real-time and historical rooftop solar generation data for the Sri Lanka Sustainable Energy Authority. Installation metering devices push readings; SLSEA national, provincial and district analysts read data within their jurisdiction. There is no client application: the OpenAPI/Swagger surface is the interface.

- **Repository:** https://github.com/Enstorm5/solar-web-api-cw
- **Production:** https://slsea-solar-api-psi.vercel.app
- **Swagger UI:** https://slsea-solar-api-psi.vercel.app/docs · **OpenAPI:** `/openapi.json`
- **Base path:** `/solar/v1.0` (all business resources need a bearer JWT)
- **Stack:** Node.js 22, TypeScript, Express 5, PostgreSQL 18 (Neon, `ap-southeast-1`), Vercel Functions (`sin1`)

## Domain model

Province → District → GridSubstation → SolarInstallation → GenerationReading, plus User.

- The meter identifier (`meter_id`) is an attribute of `SolarInstallation`; there is no Device entity.
- `generation_readings` is an append-only time series: the API never updates or deletes it, the runtime database role has no `UPDATE`/`DELETE`/`TRUNCATE` on it, and a trigger rejects modification even for privileged sessions.

## Resources

| Method | URI | Who |
|---|---|---|
| GET | `/provinces`, `/provinces/{province-id}`, `/provinces/{province-id}/districts` | analysts |
| GET | `/districts`, `/districts/{district-id}`, `/districts/{district-id}/grid-substations` | analysts |
| GET | `/districts/{district-id}/generation-summary?date=&as-of=` | analysts |
| GET | `/grid-substations`, `/grid-substations/{substation-id}`, `/grid-substations/{substation-id}/installations` | analysts |
| GET | `/installations`, `/installations/{installation-id}` | analysts (atom also provisioning service) |
| GET | `/installations/{installation-id}/overview`, `/installations/{installation-id}/last-known-reading` | analysts |
| GET | `/installations/{installation-id}/readings?from=&to=&sort=&limit=&offset=`, `/readings/{reading-id}` | analysts |
| GET | `/readings?province-id=&district-id=&substation-id=&from=&to=&sort=&limit=&offset=` | analysts |
| POST | `/installations/{installation-id}/readings` | that installation's device only |
| POST | `/grid-substations/{substation-id}/installations` | provisioning service |
| PUT, DELETE | `/installations/{installation-id}` (requires `If-Match`) | provisioning service |

Collections return `{ data, count, limit, offset, next, previous }`. Every GET carries a strong `ETag` (conditional GET → `304` with an empty body); installations and readings also carry `Last-Modified`. Errors use one body: `{ code, message, description, error[], request_id }`.

## Security model

| Principal (`principal` claim) | Scope | Access |
|---|---|---|
| `device` (sub = installation id) | `installation-write` | POST readings for its own installation only |
| `user` (sub = users.subject) | `analyst-read-national` / `-province` / `-district` | Read within the jurisdiction stored in the `users` table |
| `service` | `installation-manage` | Installation metadata lifecycle only |

Tokens are ES256 JWTs validated for signature, algorithm, issuer, audience and expiry. Jurisdiction and activity come from the database on every request; out-of-jurisdiction resources are indistinguishable from nonexistent ones (404) and filters can only narrow results.

## Local development

Requires Node.js 22. Tests download PostgreSQL 18 binaries via `embedded-postgres` (no Docker needed).

```bash
npm ci
npm run typecheck && npm run lint
npm test                    # unit tests
npm run test:integration    # real PostgreSQL: migrations, seed, API as the least-privilege role
npm run db:local            # local PostgreSQL on :54320 (keep running in another terminal)
```

Configuration is read from environment variables (see `.env.example`); scripts load `.env` when present. Never commit real values.

> **PowerShell:** call `npm.cmd` instead of `npm` when passing arguments after `--` (e.g. `npm.cmd run token -- issue …`); PowerShell otherwise consumes the `--` and npm misreads the flags.

## Operations

| Command | Purpose |
|---|---|
| `npm run db:migrate` | Apply `migrations/*.sql` once each (tracked, advisory-locked). Uses `MIGRATION_DATABASE_URL`. |
| `npm run db:seed` | Idempotent synthetic seed: 9 provinces, 25 districts, 30 substations, 201 installations, 8 days × 96 readings × 200 sites. `SEED_ANCHOR_UTC`, `SEED_DAYS`, `SEED_RANDOM_SEED`. |
| `npm run db:verify` | Seed scale/integrity checks (set `SEED_ANCHOR_UTC` to check only the seeded window once live data exists). |
| `npm run db:runtime-role` | Create/rotate the `solar_api` least-privilege role; writes its URL to `.env` (same database only). |
| `npm run token -- keygen` | Create the ES256 key pair in `.secrets/` (git-ignored). The API only gets the public key. |
| `npm run token -- issue --principal user --sub analyst-cmb --scope analyst-read-district --ttl 30d` | Issue a token (printed to stdout only). |
| `npm run token -- inspect <token>` | Decode header/claims and verify the signature, issuer, audience and expiry locally. |
| `npm run token -- tamper <token> --sub analyst-national` | Security demo: edits claims but keeps the old signature; the API answers 401. |
| `SIM_BASE_URL=… npm run simulate` | Emulate devices: append the missing 15-minute readings up to now through the API. |
| `SMOKE_BASE_URL=… npm run smoke` | Read-only checks against a deployment. |

Seeded analyst subjects: `analyst-national`, `analyst-wp`, `analyst-cp` (provincial), `analyst-cmb`, `analyst-kdy` (district). Device subjects are installation UUIDs (`/installations` lists them).

### Deployment

The Vercel project is connected to this GitHub repository: every push to `main` builds and deploys to production automatically, and other branches get preview deployments (behind Vercel authentication, with no database credentials). Vercel builds with `npm run build` (writes `public/openapi.json` and Swagger assets) and serves `src/app.ts` as one function in `sin1`, next to the Neon database. Production environment variables: `DATABASE_URL` (pooled, `solar_api` role), `JWT_PUBLIC_KEY`, `JWT_ISSUER`, `JWT_AUDIENCE`. Preview deployments deliberately have no database credentials. Migrations and seeding run from a workstation, never during a request or build — run `npm run db:migrate` against production *before* pushing code that needs a new migration.

### Examiner access

Bearer tokens are never published in this repository or in Swagger. Issue scoped tokens with `npm run token -- issue …` (a lifetime that covers marking, e.g. `--ttl 60d`) and deliver them through the private submission channel; reissue the same way if they expire. In Swagger, use **Authorize** and paste the token.

## Known limitations

- Offset pagination can shift while devices insert; use a fixed `to` bound for reproducible paging.
- The district energy figure is a boundary-sampled estimate; sites with missing boundaries or meter resets are excluded and counted.
- Errors generated by the hosting platform before or after the function (e.g. its own conditional-request handling) do not use the API error body.
- The provisioning service is trusted on token signature alone (no database record); revocation is by key rotation or short token lifetimes.
