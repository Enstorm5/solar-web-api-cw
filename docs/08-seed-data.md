# 08 – Seed data

*PLAN.md §14*

## Volume

| Item | Brief minimum | Plan | Built (production) |
|---|---:|---:|---:|
| Provinces | 9 | 9 | 9 |
| Districts | 25 | 25 | 25 |
| Grid substations | 20+ | 30, at least one per district | 30 |
| Installations | 200+ | 200 | 201 (200 reporting + 1 newly commissioned with no readings) |
| Interval | fixed | 15 min | 15 min |
| History per site | ≥ 1 week | 7 days | 8 days (768 readings per site) |
| Seeded readings | — | 200 × 7 × 96 = 134,400 | 200 × 8 × 96 = **153,600** |
| Users | — | national + ≥ 2 provincial + ≥ 2 district | 5: `analyst-national`, `analyst-wp`, `analyst-cp`, `analyst-cmb`, `analyst-kdy` |

Total readings grow as the simulator and demos add live data: 154,891 on 2026-10-10. The installation with no readings (MTR-000201) exists to demonstrate an empty history and a `null` latest reading.

## Generation rules

1. **Reproducible:** a fixed random seed (`SEED_RANDOM_SEED`, default 20261007) and a recorded anchor time (`SEED_ANCHOR_UTC`). Same inputs give the same ids and values.
2. **Real geography, synthetic assets:** the 9 provinces and 25 districts are real. Substation and site names are clearly synthetic ("Rooftop site 1 (synthetic)"), so the data is never mistaken for real SLSEA telemetry.
3. Plausible capacities, meter ids (`MTR-000001` …) and stable foreign keys.
4. **Power follows Sri Lankan daylight:** zero at night, a smooth daytime curve, bounded weather variation.
5. **Energy integrates power** over each 0.25 h step (trapezoidal), so the cumulative register never decreases in the seed.
6. Voltage varies plausibly. Invalid and extreme values live only in test fixtures.
7. Parents are inserted first and readings in batches, by a command-line job, never inside an API request.

## Repeatable and safe

- **Idempotent:** stable ids plus `ON CONFLICT`, so rerunning never duplicates or deletes anything.
- Production is never truncated automatically. Secrets never appear in output.

## Checks (`npm run db:verify`)

Counts (9/25/30/≥200), every district has a substation, every substation has installations, ≥ 672 readings and ≥ 168 h of history per reporting site, no orphan rows, unique meter ids, zero power at night, positive power at midday, register never decreases, fixed 15-minute interval.

The fixed-interval check legitimately fails once live readings arrive after a gap. Run it straight after seeding, or set `SEED_ANCHOR_UTC` to check only the seeded window.

## Freshness: being honest about "real-time"

A one-off seed does not prove continuous ingestion. Before the viva, run the device simulator (`npm run simulate`). It posts the missing readings **through the public API** as each device, continuing every meter's register. Old timestamps are never rewritten to fake liveness. Until fresh data exists, the summary correctly marks sites as stale.
