# 12 – Plan vs build

PLAN.md was never updated after it was written. When it disagrees with the decisions below, **the decisions win**. Full records are in PROJECT.md §2 and ARCHITECTURE.md §13.

## Conflicts that needed a decision

| ID | Question | Decision |
|---|---|---|
| Q1 | How to offer CRUD when devices write only readings and analysts never write | A separate provisioning **service** principal with scope `installation-manage`, which manages installation metadata only. It is token-only, with no database row (AD-12, AD-22) |
| Q2 | Summary URI: G §5.1 says verb and not nested; the rubric says nouns | Top-level noun `/district-generation-summary?district-id=`. This follows G's structural rule (top level, district as a parameter) and the rubric's noun rule, deviating from G only on the verb. It replaced the nested URI, and no duplicate route was kept (AD-11, `5c1218b`) |
| Q3 | G §1 says Level 1; B says Level 2 | Level 2, as the brief requires |
| Q4 | G §7.4 on DELETE idempotency | RFC 9110 §9.2.2: idempotency is about server state, not identical responses |
| Q5 | Hand-in and viva dates | **Still open:** check the LMS |

## Where the build differs from PLAN.md

| ID | PLAN.md says | Built instead | Why |
|---|---|---|---|
| D1 | Error body `{code, message, details[{field, reason}]}` | `{code, message, description, error[{code, field, message}], request_id}` | G §11's field names |
| D2 | Query names `province_id`, `as_of` | `province-id`, `district-id`, `substation-id`, `as-of`; JSON stays snake_case | G §5.1 rejects underscores; the rubric says "hyphenated … throughout" |
| D3 | Commit Requirements/ and the plan to the repo | Kept local, listed in `.git/info/exclude` | Your instruction |
| D4 | `PROMPTS.md` | Local `AI_LOG.md` (not committed) | Your instruction |
| D5 | Vercel Express setup to be verified | `src/app.ts` default export, ESM; local runner in `scripts/dev.ts` | Vercel docs re-checked 2026-10-07 |
| D6 | Summary at `/districts/{district-id}/generation-summary` | `/district-generation-summary?district-id=&date=&as-of=` | Q2 decision |
| D7 | Successful DELETE → 200 + JSON | **204 No Content** | Vercel's edge turned a successful delete with a body into its own 412 (AD-21) |
| D8 | "Real PostgreSQL", no version | PostgreSQL 18 everywhere, embedded PG 18 for tests | Neon defaults to 18.6; PG 18 reports FK RESTRICT as 23001 (AD-20) |
| D9 | Deploy with the CLI per release | `git push origin main` auto-deploys | CLI deploys could ship untracked files (AD-26) |
| D10 | Generate Swagger assets at build time | Assets committed in `public/swagger-ui/vendor`; `/openapi.json` served live from the YAML | Vercel takes `public/` before the build runs |
| D11 | Folders `src/schemas/`, `docs/decisions/`, `docs/evidence/`, `tests/contract/`, `tests/fixtures/` | Schemas inside route modules; decisions in ARCHITECTURE.md §13; evidence in PROJECT.md §4; contract tests in `tests/integration/contract.test.ts` and `tests/unit/openapi.test.ts` | Fewer duplicate documents; nothing required was dropped |
| D12 | Provisioning principal "provisional" | Implemented as the `service` principal, token-only | Q1 decision |

## Additions the plan did not spell out

| Decision | What | Ref |
|---|---|---|
| Database trigger | Rejects UPDATE/DELETE on readings, even for the owner role | AD-15 |
| Seed | 8 days instead of 7 (153,600 readings), plus one non-reporting installation for empty-history demos | AD-16 |
| Runtime role | `solar_api`: SELECT on the domain, INSERT on readings, INSERT/UPDATE/DELETE on installations, nothing else | AD-17 |
| Error precedence | 401 → 406 → 403 → 400 → 404 | AD-19 |
| Overview serialisation | Mapped in TypeScript so timestamps always end in `Z` | AD-23 |
| Device simulator | `npm run simulate` posts missing readings through the API as each device | AD-24 |
| `.env` guard | The runtime-role script only rewrites `.env` for the same database host (after an incident) | AD-25 |
| Test exit code | Removed an embedded-postgres hook that made failing test runs exit 0 | `6d4cf45` |
