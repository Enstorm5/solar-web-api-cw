# Project Tracker: NB6007CEM Solar Generation API

**Plan:** `PLAN.md` · **Architecture:** `ARCHITECTURE.md` · **AI log:** `AI_LOG.md` · **Local rules:** `CLAUDE.md`
**Last updated:** 2026-10-07

## 0. Continuation checkpoint (read first)

**State at 2026-10-07 (end of session 1):** all agent-doable phases (0-13) are complete; only student-only work remains.

| Fact | Value |
|---|---|
| Git | 42 commits on `main`; HEAD `ccc9e5a` = `origin/main` (https://github.com/Enstorm5/solar-web-api-cw, PUBLIC) |
| Production | https://slsea-solar-api-psi.vercel.app (`/docs`, `/openapi.json`); auto-deployed from GitHub `main`; latest deploy = `ccc9e5a`, smoke 19/19 |
| Tests | 21 files / 208 tests pass (`npx vitest run`); clean-clone audit passed (T-13) |
| Database | Neon PG 18.6: seed 153,600 readings (verify 15/15) + 1,000 simulator readings up to 2026-10-07T15:45Z |
| Endpoints | 21 operations; list in README.md "Resources" table; contract in `openapi/openapi.yaml` |

**Verify the state before doing anything (5 minutes):**
1. `git status` (tracked tree should be clean) and `git log -1` (expect `ccc9e5a` or later; compare with `git rev-parse origin/main`).
2. `npx vitest run` → 21 files / 208 tests pass (and exit code 1 on any failure since 6d4cf45).
3. PowerShell: `$env:SMOKE_BASE_URL="https://slsea-solar-api-psi.vercel.app"; npm.cmd run -s smoke` → 19 PASS. (Needs `.secrets/jwt-private.pem`.)
4. If summaries show everything stale, that is expected when no recent readings exist; see "simulate" below.

**Agent work remaining:** none blocking. Optional: rate limiting (not implemented, documented limitation); simulator `--max-steps` default 96 means a long gap needs repeated runs or a larger value.

**Open items for the student (eligibility gate / security):**
1. **Rotate the Neon `neondb_owner` password** (pasted in chat), then update `MIGRATION_DATABASE_URL` in `.env`. (Runtime `solar_api` password is separate.)
2. **Add the module leader as GitHub collaborator** (needs their verified GitHub username; do not infer) and confirm acceptance. Command once known: `"C:\Program Files\GitHub CLI\gh.exe" api -X PUT repos/Enstorm5/solar-web-api-cw/collaborators/<username>`.
3. Unanswered question: keep the repo **public** or switch to private (plagiarism-copying risk)? Not decided by the student yet.
4. Confirm LMS hand-in and viva dates (Q5); issue examiner tokens with a lifetime covering marking (`npm.cmd run -s token -- issue … --ttl 60d`), deliver privately.
5. Report (own words, 2,250-2,750 words, six sections incl. Level-2 RMM and the summary-naming justification), signed declaration, AI appendix from `AI_LOG.md`.
6. Before the viva: `npm run simulate` then `npm run smoke` against production; demo script in `TESTING_GUIDE.md` §5.

**Secrets and access inventory (locations only; never copy values into docs):**

| Item | Where |
|---|---|
| Neon owner URL (migrations/seed) | `.env` `MIGRATION_DATABASE_URL` |
| Neon runtime URL (`solar_api`, least privilege, pooled) | `.env` `DATABASE_URL` and Vercel Production env `DATABASE_URL` (sensitive) |
| JWT private key | `.secrets/jwt-private.pem` (only copy; losing it = all tokens unverifiable until new pair + Vercel update) |
| JWT public key | `.secrets/jwt-public.pem`; `.env` and Vercel `JWT_PUBLIC_KEY` (base64 PEM); also `JWT_ISSUER`, `JWT_AUDIENCE` |
| Demo tokens (1-day) | `.secrets/demo-tokens.txt` (expired after 2026-10-08) |
| Local runtime-role URL | `.secrets/runtime-database-url.localhost` |
| Vercel | CLI logged in as `enstorm5`; `.vercel/project.json` links project `slsea-solar-api`; `.env.local` holds a Vercel OIDC token |
| GitHub | gh CLI at `C:\Program Files\GitHub CLI\gh.exe` (not on Git Bash PATH), logged in as `Enstorm5` (keyring); git pushes via Git Credential Manager |

**Local docs (all excluded from git via `.git/info/exclude`):** CLAUDE.md (rules), PROJECT.md (this), ARCHITECTURE.md (design + AD-01..AD-26), AI_LOG.md (disclosure evidence), TESTING_GUIDE.md (student's manual test + viva guide), PLAN.md (original plan; superseded points listed in §2), Requirements/ (PDFs).

## 1. Requirements checklist (verified against PDFs 2026-10-07)

B = Coursework brief, R = Marking rubric, G = WSO2 guidelines. State: ☐ todo · ◐ partial · ☑ done+verified.

| ID | Requirement | Source | Plan § | State |
|---|---|---|---|---|
| REQ-01 | Five-entity hierarchy Province→District→GridSubstation→SolarInstallation→GenerationReading + User; correct 1:N cardinalities; model stated implementation-independently | B §3; R dim1; G §3 | 7.1 | ☑ schema + T01; report must state model |
| REQ-02 | meter_id/inverter_id is an installation attribute (no Device entity); readings are append-only time series (not last-value fields); reading has installation, timestamp, power kW, cumulative kWh, voltage | B §3; R dim1 | 7.1-7.2 | ☑ schema, trigger, role grants, T01 |
| REQ-03 | Collection + atomic resources for provinces, districts, grid substations, installations; scoped sub-collections where a collection only makes sense under a parent | B §5; R dim2/3; G §4.2, 5.6 | 8.1 | ☑ T-5 (local + production smoke) |
| REQ-04 | Installation composite resource | B §5; G §4.3 | 8.1 | ☑ T-8 |
| REQ-05 | Last-known-reading derived resource per installation | B §5-6 | 8.1 | ☑ T-8 |
| REQ-06 | Scoped readings sub-collection per installation | B §5; R dim2 | 8.1 | ☑ T-7 |
| REQ-07 | Device ingestion: POST, 201 + Location (+ETag, Last-Modified, Content-Location good practice) | B §5; R dim2; G §7.3, 9 | 8.2 | ☑ T-6 local; production: 1,000 simulator POSTs (T-12) |
| REQ-08 | CRUD semantics on writable resources, correct methods/idempotency; complete PUT only | B §5; R dim2/3; G §7 | 8.3 | ☑ T-9 local + production (provisioning principal) |
| REQ-09 | Pagination with count, next, previous (offset/limit) | B §5; R dim3; G §10.3 | 9.1, 10 | ☑ T-7 |
| REQ-10 | Filtering by province/district/substation and time window | B §5; R dim3; G §10.2 | 10.1 | ☑ T-7 |
| REQ-11 | Sorting by timestamp asc + desc | B §5; R dim3 | 10.1 | ☑ T-7 |
| REQ-12 | Conditional GET → 304 empty body (If-None-Match / If-Modified-Since; INM precedence) | B §5; R dim3; G §10.4 | 11 | ☑ T-8 (every GET) |
| REQ-13 | Headers: Location, ETag, Last-Modified, Content-Type; status codes 200/201/400/404/406/412 (+304, 401, 403, 409, 415) | B App.A; R dim2; G §8-9 | 9.2 | ☑ T-6/8/9/11 |
| REQ-14 | 406 when Accept excludes JSON; JSON for all resources | B §5; G §6, 10.1 | 9.2 | ☑ T-4/T-11 |
| REQ-15 | One consistent error body: code, message, supporting detail | B §5; G §11 | 9.3 | ☑ T-11 (schema-validated); platform-generated errors excepted |
| REQ-16 | JWT bearer; device authenticates as its installation (write-only own readings); readers read-only with jurisdiction scope, no cross-jurisdiction leakage; scopes e.g. installation-write, analyst-read-by-district; HTTPS | B §2, 5; R dim7; G §12 | 12 | ☑ T-4/6/8/9; HSTS + 308 verified |
| REQ-17 | Understand scope vs attribute-based (ABAC) trade-off | R dim7; G §12.3 | 12.3 | ☐ (report/viva) |
| REQ-18 | District generation summary (current total power, today's energy) — upper-band | B §5-6; R dim3 | 13 | ☑ T-10; URI `/district-generation-summary?district-id=` (`5c1218b`) |
| REQ-19 | Seed: 9 provinces, 25 districts, ≥20 substations, ≥200 installations, ≥1 week readings per installation, fixed interval, FK-consistent, diurnal shape | B §4; R dim5 | 14 | ☑ Neon verify 15/15 |
| REQ-20 | Every endpoint correct vs seed incl. empty sets, not-found, conditional requests | R dim5 | 18 | ☑ integration suite + production smoke |
| REQ-21 | Public HTTPS deployment populated with seed; live Swagger served from deployment | B §7, 13; R dim6 | 16 | ☑ auto-deployed from GitHub; latest `5c1218b`, smoke 19/19 |
| REQ-22 | Git repo shared with module leader (collaborator); incremental per-increment commits | B §7, 12, 13; R dim6 | 16.3 | ◐ public GitHub, 37 commits pushed; collaborator invite pending (student) |
| REQ-23 | Richardson Level 2 target; Level 3 out of scope (state honestly) | B header, §8; R dim8 | 22 | ☐ (report) |
| REQ-24 | Backend only; no dashboard/client | B §13 | 1 | ☑ by scope |
| REQ-25 | Report 2250-2750 words, six sections, signed declaration, AI appendix (prompts + AI aids); report prose must be the student's own | B §8, 10, 12; R dim8 | 22 | ☐ student |
| REQ-26 | Generated code critiqued; mistakes identified and repaired; disclosure complete | B §10; R dim4 | 20 | ◐ AI_LOG.md active |
| REQ-27 | Viva: explain every artefact | B §9; R gate | 23 | ☐ student |

## 2. Plan verification findings and open decisions

### Contradictions — flagged, need student/lecturer decision

| ID | Conflict | Sources | Plan's proposal | Status |
|---|---|---|---|---|
| Q1 | "Full CRUD on the write path" vs devices "can write nothing else", users never write, readings append-only | B §2, §3, §5; R dim3 | Separate `installation-manage` provisioning principal does CRUD on installation metadata only | **DECIDED** by student 2026-10-07: provisioning principal |
| Q2 | Summary is a "processing-style resource" (B §5) — G §5.1 says processing resources are verbs and not sub-resources of individual resources; R dim2 says "nouns… verbs avoided" | B §5-6; G §5.1; R dim2 | Noun `GET /districts/{district-id}/generation-summary`, justify in report | **DECIDED** by student 2026-10-07: noun URI; REVISED same day to top-level `GET /district-generation-summary?district-id=` (meets rubric + WSO2 structural rule; only the verb rule is deviated, justified) — `5c1218b` |
| Q3 | G §1 says guidelines reach Level 1; G §2 and B say Level 2 | G §1-2; B header | Follow B (Level 2) | Accepted (doc in report) |
| Q4 | G §7.4 claims 200-then-404 DELETE is "not quite" idempotent | G §7.4; RFC 9110 §9.2.2 | Idempotency = server state effect; 200 then 404 | Accepted |
| Q5 | Hand-in / viva dates not in brief ("Refer to LMS") | B cover | Record when known | OPEN (student) |

### Plan deviations found during verification (resolved by default, recorded in ARCHITECTURE.md §13)

| ID | Finding | Resolution |
|---|---|---|
| D1 | Plan error body `{code,message,details[{field,reason}]}` doesn't match G §11 field names (`code`, `message`, `description`, `moreInfo`, `error[]` of `{code,message}`) | Use G §11 names: `code`, `message`, `description`, `error[]` (`code`, `message`, `field`), plus `request_id` |
| D2 | Plan query params `province_id`, `as_of` use underscores; G §5.1 forbids underscores in URI names; R dim2 "hyphenated… throughout" | Hyphenated query parameter names (`province-id`, `district-id`, `substation-id`, `as-of`); JSON body fields stay snake_case |
| D3 | Plan §16.3.1 says commit Requirements/plan to the repo | Superseded by student instruction: these stay local via `.git/info/exclude` |
| D4 | Plan references `PROMPTS.md` (never created) | Replaced by local `AI_LOG.md` (not committed) |
| D5 | Vercel Express contract (re-checked 2026-10-07, docs updated 2026-08-10): `src/app.ts` default export, ESM, static assets only from `public/`, `express.static()` ignored | Plan §16.3 confirmed; local runner lives in `scripts/dev.ts` (not `src/server.ts`/`src/index.ts`, which Vercel would also detect) |

### Deviations from PLAN.md made during implementation (PLAN.md itself is NOT updated; trust these)

| ID | PLAN.md says | Implemented instead | Why / evidence |
|---|---|---|---|
| D6 | §8.1/§13 summary at `/districts/{district-id}/generation-summary` | `GET /district-generation-summary?district-id=&date=&as-of=` | Student decision; rubric nouns + WSO2 §5.1 structure (AD-11, `5c1218b`) |
| D7 | §8.3 successful DELETE → 200 with JSON result | 204 No Content | Vercel edge re-evaluates If-Match on DELETE responses with a body (T-9b, AD-21) |
| D8 | §5 "real PostgreSQL" tests (no version) / §16 Neon | PostgreSQL 18 everywhere (embedded-postgres 18 for tests) | Neon default is 18.6; PG18 reports FK RESTRICT as 23001 (AD-20) |
| D9 | §16.3 deploy with CLI per release | Git push to `main` auto-deploys (Vercel Git integration) | AD-26; CLI deploys could ship untracked files |
| D10 | §16.3.5 generate docs assets at build | Swagger UI assets vendored (committed) in `public/swagger-ui/vendor`; `/openapi.json` served live from YAML | Vercel collects `public/` before build (T-14) |
| D11 | §15 `src/schemas/`, `docs/decisions/`, `docs/evidence/`, `tests/contract/`, `tests/fixtures/` folders | Schemas inline in route modules; decisions in ARCHITECTURE.md §13; evidence in PROJECT.md §4; contract tests under `tests/integration/contract.test.ts` and `tests/unit/openapi.test.ts` | Fewer duplicate documents; nothing required by brief/rubric dropped |
| D12 | §12.1 provisioning principal "provisional" | Implemented as `service` principal, token-only (no DB row) | Q1 decision (AD-22) |

## 3. Milestone board

| Phase | Deliverable | State | Evidence |
|---|---|---|---|
| 0 | Requirements review, repo, tooling | Done | §4 T-0 |
| 1 | Conceptual model, decisions | Done | ARCHITECTURE.md §13 |
| 2 | OpenAPI contract | Done (read + ingest; CRUD/summary added in 9/10) | T-2, `b5d9b86` |
| 3 | Schema, migrations, seed | Done locally | T-3a/b, `4eb3164` |
| 4 | Auth foundation + early Vercel/Neon deploy | Done | T-4a..f; `5a6af65`..`127bc84` |
| 5 | Scoped hierarchy reads | Done | T-5; `81cade3`, `65fb6b1`, `e558de6` |
| 6 | Installation-bound ingestion | Done | T-6; `b840708` (+fix `9e8e3e9`) |
| 7 | History/regional queries | Done | T-7; `b6ccc6f`, `1c8d0cf` |
| 8 | Overview/latest + conditional GET | Done | T-8; `b70b021`, `3193557` |
| 9 | Metadata CRUD | Done | T-9; `76efe92`, `a699524`, `820d214` |
| 10 | District summary | Done | T-10; `b2c19b6`, `9c49285`, `244e56c`, `1072a56` |
| 11 | Security/error/contract audit | Done | T-11; `e98014c` |
| 12 | Final deployment + ops | Done | T-12; `85edbed`, `ff4a847`, release `d0b7130` |
| 13 | Reproducibility audit | Done | T-13 |
| 14-15 | Report / viva | Student-only | |

## 4. Test results (actual runs only)

| ID | Date | Phase | Command | Result |
|---|---|---|---|---|
| T-0 | 2026-10-07 | 0 | `npm run typecheck`, `npm run lint`, `npm test` | tsc clean; eslint clean; vitest 1 file / 1 test passed |
| T-2 | 2026-10-07 | 2 | `npm test` (OpenAPI suite) | 4 contract tests pass (swagger-parser validate, hyphenated names, unique operationIds + 401/406, 304/201). Negative check: broken `$ref` copy rejected by validator |
| T-3a | 2026-10-07 | 3 | `npm test`; `npm run test:integration` | unit 3 files/13 tests pass; integration 2 files/9 tests pass in 23.6 s on embedded PG 17.10 (T01 constraints: dup 23505, append-only trigger 23001, FK 23503, checks 23514, role/jurisdiction 23514, unique meter 23505, migration rerun no-op; T12 verifySeed all pass; seed rerun inserts 0) |
| T-4a | 2026-10-07 | 4 | `npm test` | 5 files / 48 unit tests pass (incl. 28 HTTP helper, 7 token tests: foreign key, iss/aud/exp, alg:none, HS256 key confusion, missing claims). First run found defect: kid derivation threw for non-extractable keys → fixed |
| T-4b | 2026-10-07 | 4 | `vitest run` principal + app-foundation (embedded PG) | principal 5/5; app-foundation 14/14 (401/403/404/405/406/400 precedence, scoped provinces, 304, docs). Mutation check: removing province scope predicate → 3 tests fail (restored) |
| T-4c | 2026-10-07 | 4 | Local dev server curl | /docs, /swagger-ui/init.js, vendor bundle+css, /openapi.json → 200; /solar/v1.0/provinces → 401 |
| T-6 | 2026-10-07 | 6 | ingestion suite (embedded PG 18) | 18/18: 201 + Location/Content-Location/ETag/Last-Modified; reader GETs Location (same ETag); outsider 404; device read 403; other device/analyst 403; dup 409 no overwrite; 6 concurrent identical POSTs -> exactly one 201; late reading 201; 7 validation 400s; malformed 400; text/plain 415; PUT/PATCH/DELETE reading 405 Allow GET, HEAD; deactivated installation 401. Mutation: binding check disabled -> 1 test fails |
| T-6b | 2026-10-07 | 6 | full suite after ingestion | FAILED 1 (seed verifier interval check saw ingested readings) — but commit b840708 had already gone in (grep-gated chain). Fixed in 9e8e3e9 by scoping series checks to the seed window; 115/115 |
| T-7 | 2026-10-07 | 7 | history suite + full suite; production timings | 22 history tests (inclusive/exclusive bounds, +05:30 offset, asc/desc, 768-count paging incl. beyond-end, contiguous pages, encoded links, empty site, foreign 404, 7 query 400s, SQL-cross-checked regional counts, scope-before-count, id tie-break, contradictory 400, device 403, ETag change on insert, join-free national count); 14 files / 137 pass. Neon EXPLAIN: page query Index Only Scan ~4 ms; national COUNT 120 ms with joins -> joins skipped when unscoped. Production warm: filtered/installation queries 74-126 ms; unfiltered national 92-350 ms (variance) |
| T-8 | 2026-10-07 | 8 | operational + conditional suites | overview/last-known 7 tests (composite == atom, null latest, 404 never-reported, Content-Location, late reading keeps 304, newer changes ETag); conditional 11 tests: 200->304 empty body on all 16 GET URIs, stale -> 200, query change -> new ETag, outsider with valid ETag/`*` -> 404, no token + ETag -> 401. 16 files / 155 pass |
| T-9 | 2026-10-07 | 9 | CRUD suite; production lifecycle script | 13 tests: 201+headers, scoped visibility, 409 dup meter, 404 unknown substation, 400 over-specified/invalid, 403 analysts/devices, If-Match 403/412/weak 412, complete PUT, no-op keeps ETag, concurrent PUT -> [200,412], PUT never creates, history-protected 409, delete 204 then 404/404, 409 delete with readings, service has no analytics/ingest. Mutation (If-Match always true) -> 3 fail. Production: POST 201, PUT 403/200/412, DELETE 412/204/404, GET 404, history delete 409; no residue. 17 files / 168 pass |
| T-9b | 2026-10-07 | 9 | Vercel edge probe matrix (temporary preview, removed) | Edge re-evaluates If-Match on DELETE and GET responses with a body: ETag mismatch/absent -> platform 412 (text/plain, x-vercel-error) even after the function committed; PUT/POST unaffected; 204 unaffected -> DELETE now 204 |
| T-11 | 2026-10-07 | 11 | contract suite; npm audit; production header review | 20 contract tests: route inventory parity (first run caught /docs + /openapi.json misclassified by the walker — test bug, fixed), 17 GET + POST/GET reading + 6 error bodies validated against dereferenced OpenAPI (Ajv 2020). npm audit: 0 vulnerabilities (all and --omit=dev). Production: HSTS 2y preload, HTTP->HTTPS 308, nosniff, CSP, no X-Powered-By, errors no-store. 20 files / 202 pass |
| T-12 | 2026-10-07 | 12 | simulator local + production; release deploy | Local: 32 readings for 2 sites, rerun 0, no register decrease/gap. Production: 200 installations, 1,000 readings, 0 failures, 19 s; CMB summary 14/14 fresh, 0 kW (night), 674.375 kWh today. Release `d0b7130`: smoke 19/19; `SEED_ANCHOR_UTC=2026-10-07T14:45:00Z db:verify` 15/15 |
| T-15 | 2026-10-07 | 10 | summary URI moved to top-level | 206/206 (route inventory parity, summary suite incl. missing/malformed district-id 400); auto deploy 5c1218b READY; smoke 19/19; prod: new URI 200, no district-id 400, old nested URI 404; /openapi.json lists only `/district-generation-summary` |
| T-14 | 2026-10-07 | 12 | Vercel ↔ GitHub connection; push-triggered deploys | `vercel git connect` OK. Push b775553 → auto production deploy READY in sin1, but smoke 18/19: Swagger vendor files 404 (Express builder collects public/ before `npm run build`; earlier CLI deploys had uploaded locally built files). Fix 46d4432: vendored assets committed + sha256 sync test; auto deploy READY; smoke 19/19; all /docs assets 200. 21 files / 206 tests |
| T-13 | 2026-10-07 | 13 | clean clone in scratch dir | npm ci, typecheck, lint, build OK; 20 files / 202 tests pass; no forbidden path or secret pattern in any commit |
| T-10 | 2026-10-07 | 10 | summary unit + integration; production sample | unit 7 (Colombo bounds 18:30Z, local-date edges, hand fixture: power 11, energy 20.5, 5/1/1, covered 2, incomplete 5, resets 2, null energy, 900 s vs 901 s boundary); integration 7 (same fixture end-to-end via fixture district, +05:30 as-of, CMB full day equals independent SQL boundary difference, scope 404, 304 same bucket / 200 new bucket, 400 future/not-started/malformed, device 403). 19 files / 182 pass. Production: today all 14 CMB sites stale (seed ended 14:45Z) -> power 0, energy null; 2026-10-06 covered 14/14, 836.374 kWh; 180-293 ms |
| T-5 | 2026-10-07 | 5 | `vitest run` (all) ; production `npm run smoke` | 12 files / 97 tests pass (districts 9, substations 5, installations 6 new: scoping, filter intersection, 400 contradictory filters, foreign parent 404, IMS 304); smoke 17/17 on production |
| T-4d | 2026-10-07 | 4 | Neon: `db:migrate`, `db:seed` (anchor 2026-10-07T14:45Z), `db:verify`; runtime role probe | 001 applied; 153,600 readings in 25 s; 15/15 PASS; `solar_api` via pooler: non-superuser, reads 153,600, UPDATE readings -> 42501 |
| T-4e | 2026-10-07 | 4 | `SMOKE_BASE_URL=https://slsea-solar-api-psi.vercel.app npm run smoke` | 12/12 PASS (live, ready, docs, bundle, openapi, 401, 9 provinces, 304 empty, district scope, foreign 404, device 403, 406); warm requests 65-140 ms |
| T-4f | 2026-10-07 | 4 | Full suite after runtime-role + PG18 switch | 9 files / 77 tests pass (API under test runs as `solar_api` on PG 18) |
| T-3b | 2026-10-07 | 3 | `db:migrate`, `db:seed` (anchor 2026-10-07T00:00Z), `db:verify`, `db:migrate` again — local embedded PG | 153,600 readings inserted in 6 s; 15/15 verify checks PASS; second migrate "Applied: none". Plausibility: mean 4.12 kWh/kWp/day, peak 0.94×capacity, voltage 218.69-244.49 V |

## 5. Environment and version register

| Item | Value |
|---|---|
| Node (local) | 22.14.0; `engines.node` = 22.x |
| npm | 10.9.2 |
| Key packages (exact pins) | express 5.2.1, pg 8.23.1, zod 4.6.5, jose 6.2.12, @vercel/functions 3.9.11; dev: typescript 6.0.3 (typescript-eslint 8.71 requires <6.1), vitest 5.0.3, embedded-postgres 18.4.0-beta.17, ajv 8.20.0, swagger-ui-dist 5.33.1 (vendored copy in public/swagger-ui/vendor) |
| Vercel | Git integration with GitHub `main` (production) since 2026-10-07; CLI 59.25.4, account `enstorm5`; project `slsea-solar-api` (prj_Y5JmqfYosrcOvDvJEYlVjNOghJCW); `framework: express` + region `sin1` in vercel.json; Node 22.x via engines. Production-only env: DATABASE_URL (runtime role, pooled), JWT_PUBLIC_KEY, JWT_ISSUER, JWT_AUDIENCE. Preview has no DB credentials by design |
| Neon | PostgreSQL 18.6, ap-southeast-1, db `neondb`; owner `neondb_owner` (migrations/seed), runtime `solar_api` (password rotated once on 2026-10-07 after the .env incident); migration 001 applied |
| Local test DB | embedded-postgres 18.4.0-beta.17 (matches Neon major) |
| Git | `main` → origin https://github.com/Enstorm5/solar-web-api-cw (public); committer from global git config; gh CLI 2.102.0 (winget) |
| Production URL / Swagger | https://slsea-solar-api-psi.vercel.app · /docs · /openapi.json |

## 6. Seed manifest

Values below are real runs. Local dev DB was re-created on PG18 later (anchor 2026-10-07T12:00Z) and is disposable.

| Field | Local dev (2026-10-07) | Neon production |
|---|---|---|
| Seed code commit | `4eb3164` | `4eb3164` |
| Random seed | `20261007` (default) | `20261007` |
| Anchor UTC (exclusive end) | 2026-10-07T00:00:00Z | 2026-10-07T14:45:00Z |
| Start UTC | 2026-09-29T00:00:00Z (8 days) | 2026-09-29T14:45:00Z |
| Interval | 15 min; local time Asia/Colombo (UTC+05:30) | same |
| Counts | 9 provinces / 25 districts / 30 substations / 201 installations (200 reporting + 1 newly commissioned, no readings) / 5 users | same |
| Readings | 153,600 (768 per reporting installation; ≥134,400 brief minimum) | 153,600 (25 s) |
| Verify | 15/15 PASS | 15/15 PASS (2026-10-07; re-run with `SEED_ANCHOR_UTC=2026-10-07T14:45:00Z` once live data exists) |
| Live data added | — | 1,000 readings via `npm run simulate` (5 per reporting site, up to 15:45Z) |

Note: the "fixed 15-minute interval" check will legitimately fail once live device readings are ingested after a gap; run `db:verify` straight after seeding.

## 7. Release and submission gates

See PLAN.md §23 checklist; tick here only with evidence.

- [x] Q1/Q2 resolved (student decision 2026-10-07)
- [x] Public HTTPS API + /docs, no Vercel login wall (T-4e, T-12, T-15)
- [x] Git-based deployments verified (T-14)
- [x] Seed volume verified on production DB (15/15)
- [ ] Repo shared with module leader (verified)
- [ ] Examiner credentials + renewal arranged
- [x] No secrets in repo history (T-13); Neon owner password still needs rotation (pasted in chat)

## 8. Change log

| Date | Work | Outcome |
|---|---|---|
| 2026-10-07 | Planning pack created (prior AI-assisted session) | PLAN/ARCHITECTURE/PROJECT docs |
| 2026-10-07 | Phase 0: requirements verified, checklist, repo + exclusions, tooling scaffold | T-0 passed |
| 2026-10-07 | Phase 1: decisions AD-01..AD-15 + data dictionary in ARCHITECTURE.md | docs only |
| 2026-10-07 | Phase 2: OpenAPI 3.1 contract (17 operations) | T-2 passed |
| 2026-10-07 | Post-release: token inspect/tamper, GitHub repo + Vercel Git integration, vendored Swagger assets, summary URI moved top-level, handoff docs refreshed | T-14, T-15 |
| 2026-10-07 | Phases 11-13: contract/security audit, simulator, runtime-role guard, README, clean-checkout audit, release d0b7130 | T-11..13 |
| 2026-10-07 | Phases 8-10: overview/latest, conditional suite, CRUD, DELETE 204 (Vercel edge), summary | T-8..10 |
| 2026-10-07 | Phase 4: HTTP helpers, JWT/principals, app pipeline, provinces, docs, runtime role, Neon seed, Vercel deploy, smoke | T-4a..f |
| 2026-10-07 | Phase 3: schema, migration runner, deterministic seed, verifier, embedded-PG integration harness | T-3a/T-3b passed |
