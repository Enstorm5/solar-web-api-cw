# 07 – District generation summary

*PLAN.md §13*

The brief marks the summary as stretch work. The plan makes it part of the baseline to target the top band.

## The request

```
GET /solar/v1.0/district-generation-summary?district-id={uuid}&date=YYYY-MM-DD&as-of=<RFC 3339>
```

**Changed:** planned as `/districts/{district-id}/generation-summary?date=&as_of=`. It was moved to the top level, with the district as a parameter and `as-of` hyphenated (see [12](12-plan-vs-build.md)).

| Parameter | Default | Rules |
|---|---|---|
| `district-id` | required | Unknown or outside your area → 404 |
| `date` | Today in `Asia/Colombo` | A calendar day in Sri Lanka |
| `as-of` | Now, rounded down to the minute | At most 5 minutes in the future; used everywhere in the query |

**Time zone trap:** Sri Lankan midnight is 18:30 UTC the previous day. The day's UTC bounds are computed from the time zone, never assumed. The period ends at whichever comes first, `as-of` or the end of the local day.

## Current power

1. For each installation, take its **one most recent** reading at or before `as-of`.
2. Sum only the readings that are **fresh**, within 30 minutes (`freshness_seconds: 1800`).
3. Count every site as fresh, stale or missing. A stale meter is never assumed to produce zero.

## Daily energy

1. Each meter has a cumulative register (kWh), so energy = **register at the period end − register at the period start**.
2. For each boundary, use the latest reading at or before it, and only if it is at most one interval old (`max_boundary_age_seconds: 900`). This is a **boundary-sampled estimate** when readings do not land exactly on the boundary.
3. A site without both boundaries counts as **incomplete** and is left out of the estimate.
4. A register that goes **down** means a meter reset. That site is excluded and counted in `meter_reset_installation_count`; the value is never clamped to zero.
5. If no site has usable boundaries, `estimated_energy_kwh` is **`null`**, not 0.

A genuine 0 kW reading at night is valid data, which is different from a missing or stale reading.

## Response fields

| Field | Meaning |
|---|---|
| `district_id`, `date`, `timezone`, `as_of` | What was asked, and the evaluation instant |
| `period_start`, `period_end` | The UTC window used for energy |
| `freshness_seconds`, `max_boundary_age_seconds` | The rules applied (1800, 900) |
| `current_power_kw` | Sum of fresh sites' latest power |
| `estimated_energy_kwh` | Sum of register differences, or `null` |
| `installation_count` | Sites in the district |
| `fresh_` / `stale_` / `missing_installation_count` | Split current-power coverage; they add up to `installation_count` |
| `energy_covered_` / `energy_incomplete_installation_count` | Split energy coverage |
| `meter_reset_installation_count` | A subset of the incomplete count |

## Correctness and caching rules

- Computed with set-based SQL (window and lateral queries), never one query per installation.
- An authorised district with no sites → 200 with truthful zero counts.
- The formula is checked on a tiny hand-calculated test fixture, separate from the big random seed.
- The ETag covers every returned value, so a 304 is only possible within the same `as-of` minute. Crossing a freshness or day boundary can legitimately change the ETag without any new reading.
- With old data, the summary shows sites as stale and energy as `null`. That is correct; run the simulator to get fresh data.
