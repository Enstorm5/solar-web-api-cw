# PLAN.md, broken down

PLAN.md (7 Oct 2026, 24 sections, 787 lines) is the original plan for the SLSEA Solar Generation API. These pages split it into one topic per file, in plain language.

PLAN.md was written before any code existed and was never updated. Where the finished build differs from it, the page says **Changed** and points to [12 – Plan vs build](12-plan-vs-build.md). The build is the source of truth.

| # | Page | PLAN.md sections | What it answers |
|---|---|---|---|
| 01 | [Overview](01-overview.md) | §1-5 | What is being built, what is out of scope, which sources rule, how the rubric maps to work |
| 02 | [Architecture](02-architecture.md) | §6 | The layers, what each may and may not do, the order checks run in |
| 03 | [Data model](03-data-model.md) | §7 | The six entities, their links, how PostgreSQL stores them |
| 04 | [API resources](04-api-resources.md) | §8 | Every route, who may call it |
| 05 | [HTTP contract](05-http-contract.md) | §9-11 | Envelopes, status codes, errors, filters, paging, ETags, concurrency |
| 06 | [Security](06-security.md) | §12 | Principals, scopes, tokens, jurisdiction, leak prevention |
| 07 | [District summary](07-district-summary.md) | §13 | How current power and daily energy are calculated |
| 08 | [Seed data](08-seed-data.md) | §14 | What test data is generated and checked |
| 09 | [Deployment](09-deployment.md) | §16 | Vercel, Neon, environments, release steps |
| 10 | [Testing and evidence](10-testing.md) | §17-18 | Test groups T01-T15, OpenAPI checks, evidence rules |
| 11 | [Phases and checklists](11-phases.md) | §19-23 | Build order, definition of done, risks, report outline, viva checklist |
| 12 | [Plan vs build](12-plan-vs-build.md) | — | Every decision and deviation since the plan was written |

**Source letters used throughout:** B = coursework brief, R = marking rubric, G = WSO2 REST API Design Guidelines (all in `Requirements/`).

**Status on 2026-10-10:** phases 0-13 are done and verified in production. Phases 14-15 (report, viva) are yours.
