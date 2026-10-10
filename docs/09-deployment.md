# 09 – Deployment

*PLAN.md §16*

## As built

| Part | Value |
|---|---|
| API | https://slsea-solar-api-psi.vercel.app (Swagger at `/docs`) |
| Hosting | One Vercel Function from `src/app.ts`, region `sin1` (Singapore) |
| Database | Neon PostgreSQL 18.6, `ap-southeast-1` (Singapore): same region as the function |
| Repository | https://github.com/Enstorm5/solar-web-api-cw |
| Release | `git push origin main` → Vercel builds and deploys production automatically |

## Environments

| Environment | API | Database | Credentials |
|---|---|---|---|
| Local | `npm run dev` | Local PostgreSQL (`npm run db:local`, port 54320) | Development only |
| Tests | Vitest | Temporary embedded PostgreSQL 18, created and destroyed per run | Test only |
| Preview (other branches) | Vercel preview URL, behind Vercel login | **None**: previews get no database credentials | — |
| Production | Stable Vercel URL | Neon production | Public key + least-privilege `solar_api` role |

> `.env` points at **production** Neon. For local work, override both `DATABASE_URL` and `MIGRATION_DATABASE_URL`.

## Configuration

| Variable | Purpose | Where |
|---|---|---|
| `DATABASE_URL` | Pooled connection as the `solar_api` role, SSL | Vercel production (secret) |
| `MIGRATION_DATABASE_URL` | Direct owner connection for migrations and seeding | Your workstation only |
| `JWT_PUBLIC_KEY` | Verifies tokens | Vercel (never the private key) |
| `JWT_ISSUER`, `JWT_AUDIENCE` | Required claim values | Vercel |
| `SEED_ANCHOR_UTC`, `SEED_RANDOM_SEED`, `SEED_DAYS` | Repeatable seed | Seed job only |

Missing configuration fails at startup without printing secret values. Canonical URLs are never built from an untrusted `Host` header.

## Release sequence (plan §16.3, as practised)

1. Code, test and commit locally. Gate every commit on the test runner's exit code.
2. If a new migration exists, run `npm run db:migrate` against production **before** pushing. Migrations never run during a build or request.
3. `git push origin main`.
4. Wait until Vercel shows the deployment **Ready** for that commit.
5. Run `npm run smoke` against production (19 read-only checks).

## Vercel gotchas found during the build

- **Express detection:** the project needed `framework: express` in `vercel.json`, and `src/app.ts` must import express and default-export the app.
- **Static files:** Vercel collects `public/` from the repo *before* the build runs, so Swagger UI assets are committed under `public/swagger-ui/vendor`. `express.static()` is ignored on Vercel.
- **DELETE and If-Match:** Vercel's edge re-checked `If-Match` against a DELETE response that carried a body and replaced a successful delete with its own 412. Successful deletes therefore return 204.
- **CLI deploys** from a working tree can ship untracked files, which hid the missing Swagger assets. Deploy via Git push only.

## Operations and limits

- This is coursework scale, not proof of national load. No cost or latency promise is made.
- Connections are bounded: pooled endpoint for runtime, `attachDatabasePool` for clean shutdown, clients released in `finally`.
- No in-memory locks, caches or rate limiters are relied on across instances.
- **Rollback:** redeploy an earlier commit only if its schema is still compatible. Prefer additive migrations and forward fixes; an app rollback does not undo a migration.
- **Examiner access:** the deployment must be reachable without a Vercel login. Protected endpoints should give the API's own 401, not a Vercel login wall.
