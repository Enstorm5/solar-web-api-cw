# 01 – Overview

*PLAN.md §1-5*

## What is being built

A backend-only HTTPS REST API for the Sri Lanka Sustainable Energy Authority (SLSEA):

- **Solar meters** (one per rooftop installation) push generation readings in.
- **SLSEA analysts** at national, provincial or district level read the data, each limited to their own area.
- There is no app or dashboard. The live **Swagger page** is the only interface.
- The target is **Richardson Maturity Model Level 2**: resources, proper HTTP methods, status codes and headers.

"Real-time" in the plan means a device posts a reading and analysts can read the latest one straight away. It does not mean live streaming.

## Scope

| In scope | Out of scope |
|---|---|
| Six entities: Province, District, GridSubstation, SolarInstallation, GenerationReading, User | A separate Device entity (the meter id belongs to the installation) |
| Hierarchy collections, single items, parent-scoped lists | Dashboard, client app, BI tool, billing, household self-service |
| Installation overview, last-known reading, reading history, regional queries | Editing or deleting recorded readings |
| Device ingestion, validation, consistent errors, conditional requests | WebSockets, streaming, message brokers, Kubernetes |
| JWT login and jurisdiction-based access | A full OAuth server; Level 3 hypermedia |
| District generation summary | National-scale production infrastructure |
| Seed data, tests, Vercel + Neon deployment, Git history, AI-use records | |

## Sources and who wins

| Letter | Document | Authority over |
|---|---|---|
| B | Coursework brief | Domain, capabilities, seed scale, submission, integrity |
| R | Marking rubric | Eight marking dimensions and their bands |
| G | WSO2 REST API Design Guidelines | Resource modelling, URIs, HTTP design, security |
| — | RFC 9110 (HTTP Semantics) | Tie-breaker where G is out of date (e.g. idempotency) |

### Conflicts the plan flagged instead of guessing

| ID | Conflict | Plan's proposal | Outcome |
|---|---|---|---|
| Q1 | B asks for full CRUD, but also says devices write only readings, analysts never write, and readings are append-only | A separate provisioning service that manages installation metadata only | **Decided** 2026-10-07: provisioning service |
| Q2 | G §5.1 says processing resources are verbs and not nested under an individual resource; R rewards nouns | Noun URI `/districts/{district-id}/generation-summary` | **Changed:** top-level `/district-generation-summary?district-id=` (see [12](12-plan-vs-build.md)) |
| Q3 | G §1 says its guidelines reach Level 1; G §2 and B say Level 2 | Follow B: Level 2 | Accepted |
| Q4 | G §7.4 calls 200-then-404 on DELETE "not quite RESTful … not idempotent" | Follow RFC 9110 §9.2.2: idempotency is about server state | Accepted |
| Q5 | Hand-in and viva dates are not in the brief | Record them when known | Still open: check the LMS |

## Deliverables (the eligibility gate)

| Deliverable | Required |
|---|---|
| Public API | Stable HTTPS URL, populated with data, working at submission |
| OpenAPI | Public `/docs` and `/openapi.json`; protected endpoints executable with a bearer token |
| Repository | Incremental commits; module leader added as collaborator |
| Report | Written by you, 2,250-2,750 words, all six sections |
| Declaration | Signed |
| AI appendix | Real prompts, tools, critique, repairs, validation |
| Viva | Attend and explain every artefact |

> **Integrity boundary (B pp.1-2, §10):** generated code is allowed if declared, but generated prose is not acceptable in the report. These docs are study aids, not report text.

## Rubric map

| Dimension | Marks | Plan's evidence | Phases |
|---|---:|---|---|
| Architecture and data model | 15 | Six entities, correct links, meter as attribute, append-only history | 1-3 |
| API design | 20 | Resource types, consistent URIs, full PUT, specific statuses and headers | 2, 5-9 |
| Coverage | 15 | Hierarchy, overview, latest, history, CRUD, paging, filters, 304, summary | 5-10 |
| Implementation with generated code | 10 | Clear layers, recorded prompts, defects found and repaired | All |
| Functionality against seed data | 5 | Every endpoint checked against realistic data | 3, 11-13 |
| Deployment and operation | 10 | Public HTTPS, live Swagger, Neon, shared repo, many commits | 0, 4, 12-13 |
| Security and authentication | 15 | Valid JWTs, per-installation writes, no cross-area leaks | 4-11 |
| Report quality | 10 | Your own justification within the word range | 14 |

The viva validates these marks; it is not a separate category.

## Technology stack

| Concern | Plan's choice | Built with |
|---|---|---|
| Runtime | TypeScript on Node.js LTS | Node 22, TypeScript 6.0.3 (ESM) |
| HTTP | Express | Express 5.2 |
| Database | Neon PostgreSQL | Neon PostgreSQL 18.6 (ap-southeast-1) |
| SQL | `pg`, parameterised SQL, SQL migrations | Same, no ORM |
| Validation | Zod | Zod 4 |
| JWT | `jose`, fixed asymmetric algorithm | `jose` 6, ES256 |
| Contract | OpenAPI + Swagger UI | OpenAPI 3.1 YAML, Swagger UI 5 (vendored) |
| Tests | Vitest + Supertest + real PostgreSQL | Same; embedded PostgreSQL 18 |
| Hosting | Vercel | Vercel Functions, region `sin1` |
