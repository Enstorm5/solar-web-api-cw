import type pg from 'pg';

export interface SeedCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface VerifyThresholds {
  minSubstations: number;
  minReportingInstallations: number;
  minSpanHours: number;
  minReadingsPerInstallation: number;
}

export const BRIEF_THRESHOLDS: VerifyThresholds = {
  minSubstations: 20,
  minReportingInstallations: 200,
  minSpanHours: 7 * 24,
  minReadingsPerInstallation: 7 * 24 * 4,
};

export interface SeedWindow {
  from: Date;
  /** Exclusive end (the seed anchor). */
  to: Date;
}

/**
 * Database-side checks of seed scale, integrity and plausibility (brief section 4). When a seed
 * window is given, the per-series checks only examine seeded readings, so legitimately ingested
 * live or late readings outside the window do not count as seed defects.
 */
export async function verifySeed(
  client: pg.ClientBase,
  t: VerifyThresholds,
  window?: SeedWindow,
): Promise<SeedCheck[]> {
  const readings = window
    ? `(SELECT * FROM generation_readings WHERE "timestamp" >= '${window.from.toISOString()}' AND "timestamp" < '${window.to.toISOString()}')`
    : 'generation_readings';
  const one = async <T>(sql: string): Promise<T> => (await client.query(sql)).rows[0] as T;
  const checks: SeedCheck[] = [];
  const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

  const c = await one<Record<string, string>>(`SELECT
    (SELECT count(*) FROM provinces) AS provinces,
    (SELECT count(*) FROM districts) AS districts,
    (SELECT count(*) FROM grid_substations) AS substations,
    (SELECT count(*) FROM solar_installations) AS installations,
    (SELECT count(*) FROM generation_readings) AS readings,
    (SELECT count(*) FROM users) AS users`);
  add('9 provinces', Number(c.provinces) === 9, `provinces=${c.provinces}`);
  add('25 districts', Number(c.districts) === 25, `districts=${c.districts}`);
  add(
    `>=${t.minSubstations} grid substations`,
    Number(c.substations) >= t.minSubstations,
    `substations=${c.substations}`,
  );
  add(
    'total readings',
    Number(c.readings) > 0,
    `readings=${c.readings}, installations=${c.installations}, users=${c.users}`,
  );

  const every = await one<{ empty_districts: string; empty_substations: string }>(`SELECT
    (SELECT count(*) FROM districts d WHERE NOT EXISTS (SELECT 1 FROM grid_substations s WHERE s.district_id = d.id)) AS empty_districts,
    (SELECT count(*) FROM grid_substations s WHERE NOT EXISTS (SELECT 1 FROM solar_installations i WHERE i.substation_id = s.id)) AS empty_substations`);
  add(
    'every district has a substation',
    every.empty_districts === '0',
    `districts without substations=${every.empty_districts}`,
  );
  add(
    'every substation has installations',
    every.empty_substations === '0',
    `substations without installations=${every.empty_substations}`,
  );

  const span = await one<{ reporting: string; min_count: string; min_span_h: string }>(`SELECT
      count(*) AS reporting,
      min(n) AS min_count,
      min(extract(epoch FROM (last_ts - first_ts)) / 3600) AS min_span_h
    FROM (SELECT installation_id, count(*) AS n, min("timestamp") AS first_ts, max("timestamp") AS last_ts
          FROM ${readings} r GROUP BY installation_id) per_site`);
  add(
    `>=${t.minReportingInstallations} reporting installations`,
    Number(span.reporting) >= t.minReportingInstallations,
    `reporting=${span.reporting}`,
  );
  add(
    `>=${t.minReadingsPerInstallation} readings per reporting installation`,
    Number(span.min_count) >= t.minReadingsPerInstallation,
    `min readings=${span.min_count}`,
  );
  add(
    `>=${t.minSpanHours}h history per reporting installation`,
    Number(span.min_span_h) >= t.minSpanHours - 0.25,
    `min span hours=${Number(span.min_span_h).toFixed(2)}`,
  );

  const orphans = await one<{ n: string }>(`SELECT
    (SELECT count(*) FROM generation_readings r LEFT JOIN solar_installations i ON i.id = r.installation_id WHERE i.id IS NULL) +
    (SELECT count(*) FROM solar_installations i LEFT JOIN grid_substations s ON s.id = i.substation_id WHERE s.id IS NULL) AS n`);
  add('no orphan rows', orphans.n === '0', `orphans=${orphans.n}`);

  const meters = await one<{ dupes: string }>(
    `SELECT count(*) - count(DISTINCT meter_id) AS dupes FROM solar_installations`,
  );
  add('unique meter ids', meters.dupes === '0', `duplicates=${meters.dupes}`);

  // Local hour in Asia/Colombo: night (00:00-04:59) must be zero; midday (11:00-12:59) mostly positive.
  const diurnal = await one<{
    night_nonzero: string;
    midday_total: string;
    midday_positive: string;
  }>(`SELECT
    count(*) FILTER (WHERE extract(hour FROM "timestamp" AT TIME ZONE 'Asia/Colombo') < 5 AND power_kw > 0) AS night_nonzero,
    count(*) FILTER (WHERE extract(hour FROM "timestamp" AT TIME ZONE 'Asia/Colombo') IN (11, 12)) AS midday_total,
    count(*) FILTER (WHERE extract(hour FROM "timestamp" AT TIME ZONE 'Asia/Colombo') IN (11, 12) AND power_kw > 0) AS midday_positive
    FROM ${readings} r`);
  add(
    'zero generation at night',
    diurnal.night_nonzero === '0',
    `night readings with power>0: ${diurnal.night_nonzero}`,
  );
  add(
    'positive generation at midday',
    Number(diurnal.midday_positive) === Number(diurnal.midday_total) &&
      Number(diurnal.midday_total) > 0,
    `midday positive ${diurnal.midday_positive}/${diurnal.midday_total}`,
  );

  const monotonic = await one<{ decreases: string }>(`SELECT count(*) AS decreases FROM (
      SELECT cumulative_energy_kwh - lag(cumulative_energy_kwh) OVER (PARTITION BY installation_id ORDER BY "timestamp") AS delta
      FROM ${readings} r) d WHERE delta < 0`);
  add(
    'cumulative energy never decreases',
    monotonic.decreases === '0',
    `decreasing steps=${monotonic.decreases}`,
  );

  const gaps = await one<{ irregular: string }>(`SELECT count(*) AS irregular FROM (
      SELECT "timestamp" - lag("timestamp") OVER (PARTITION BY installation_id ORDER BY "timestamp") AS step
      FROM ${readings} r) d WHERE step IS NOT NULL AND step <> interval '15 minutes'`);
  add('fixed 15-minute interval', gaps.irregular === '0', `irregular steps=${gaps.irregular}`);

  return checks;
}
