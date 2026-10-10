# CLAUDE.md — working rules

Project: NB6007CEM SLSEA Solar Generation REST API (Express + TypeScript, Vercel, Neon PostgreSQL).

## On resume — read first
1. `PROJECT.md` §0 "Continuation checkpoint" (exact next step) and §1 requirements checklist.
2. Only the `PLAN.md` sections relevant to the current phase (headings: `grep -n '^#' PLAN.md`).
3. `ARCHITECTURE.md` §13 "Accepted decisions" before changing design.
4. Requirement PDFs in `Requirements/` only when a checklist item needs re-verification (text: `pdftotext -layout`).

## Documents
- `PLAN.md` — full plan (phases §19, routes §8, HTTP §9-11, security §12, summary §13, seed §14, deploy §16, tests §18).
- `PROJECT.md` — checkpoint, requirements checklist, milestone board, test results, open issues. Update after each milestone.
- `ARCHITECTURE.md` — design + decision log. Update when a design decision changes.
- `TESTING_GUIDE.md` — student's manual guide: local run, tokens, Swagger, Postman against Vercel (local only, excluded).
- `AI_LOG.md` — AI disclosure: exact user prompts, tool/model, generated work used, mistakes found, repairs, real verification results.

## Hard rules
- One phase at a time: implement → run meaningful tests → review → update PROJECT.md (+AI_LOG.md) → commit → next.
- Flag contradictory requirements (Q1 CRUD, Q2 summary URI); don't guess. Continue independent work meanwhile.
- Never record test results that were not actually run.
- Commit frequency (student request 2026-10-07): small, individually verified commits — one per coherent piece (helper module + its tests, auth layer, each route group, deploy config, …); target ≥15 commits total. Never split finished work cosmetically.
- Gate every commit on the test runner's exit code (`npx vitest run > .tmp/test.log; [ $? -eq 0 ] && git commit …`), never on a grep pipeline (b840708 was committed with a failing test that way; fixed in 9e8e3e9).
- Deploy = `git push origin main` (Vercel Git integration auto-deploys production). Avoid `vercel deploy --prod` from the working tree: it can ship uncommitted/untracked files (that hid the missing Swagger assets until 46d4432). After each push: wait for READY, then `npm run smoke`.
- PowerShell: use `npm.cmd` when passing args after `--`.
- Never `source .env` in bash (`&` in URLs); use `node --env-file` / Python.
- Git: never commit Requirements/, PLAN.md, AI_LOG.md, TESTING_GUIDE.md, REPORT_EVIDENCE.md, report-figures/ (listed in `.git/info/exclude`). PROJECT.md, ARCHITECTURE.md, CLAUDE.md and docs/ are committed (student decision 2026-10-10) — the repo is public, so keep them free of secrets. Never commit `.env*` (except `.env.example`), keys, tokens, DB URLs. Stage files explicitly, inspect `git diff --cached` before committing. Short precise messages. No history rewriting.
- Generated device/reader JWTs and private keys live only in `.secrets/` (git-ignored) or the user's secret stores.
- Invariants: readings append-only; meter_id is an installation attribute; devices write only own readings; readers never write; jurisdiction scope applied in SQL before select/count/aggregate; unknown and foreign resources both → 404.
- URIs: base `/solar/v1.0`, lowercase hyphenated path segments AND query parameter names; JSON properties snake_case.

## Commands
- Checks: `npm run typecheck` · `npm run lint` · `npm test` (unit) · `npm run test:integration` (embedded PG 18) · `npx vitest run` (all; gate commits on its exit code)
- Local: `npm run db:local` (PG on :54320) then, in another shell, override BOTH `DATABASE_URL` and `MIGRATION_DATABASE_URL` to the local URL before `npm run dev` / `db:*` (`.env` points at production Neon!)
- Ops (PowerShell: `npm.cmd`): `db:migrate`, `db:seed`, `db:verify`, `db:runtime-role` (only rewrites `.env` for the same DB host), `token -- keygen|issue|inspect|tamper` (never `keygen --force` without updating Vercel `JWT_PUBLIC_KEY`), `simulate` (`SIM_BASE_URL`), `smoke` (`SMOKE_BASE_URL`), `build` (refresh vendored Swagger assets)
- Release: commit → `git push origin main` → wait for Vercel READY (`vercel list slsea-solar-api --format json`, match `meta.githubCommitSha`) → `npm run smoke` against production
- GitHub CLI: `"C:\Program Files\GitHub CLI\gh.exe"` (not on Git Bash PATH); repo `Enstorm5/solar-web-api-cw`

## Gotchas learned (details in PROJECT.md §4 / ARCHITECTURE.md §13)
- PLAN.md is the original plan; where it disagrees with PROJECT.md §2 (D1-D12) or ARCHITECTURE.md §13, the latter win.
- Vercel edge re-evaluates `If-Match` on DELETE/GET responses with a body → successful DELETE must stay 204.
- Vercel takes `public/` from the repo before `npm run build`; anything served statically must be committed.
- Git Bash mangles leading-slash args for `vercel curl` → `MSYS_NO_PATHCONV=1`.
- `embedded-postgres` (via async-exit-hook) used to force exit code 0 on failing runs; fixed in tests/integration/global-setup.ts (6d4cf45). Still read the 'Tests' line, not only `$?`.
- Production summary freshness window is 30 min; stale/null energy is correct when no recent readings exist.
