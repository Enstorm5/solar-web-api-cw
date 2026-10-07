import type pg from 'pg';
import { buildHierarchy, floorToInterval, generateReadings, INTERVAL_MS, type Hierarchy } from './generate.js';

export interface SeedConfig {
  anchorMs: number;
  days: number;
  randomSeed: string;
  installationCount: number;
  batchSize?: number;
  log?: (msg: string) => void;
}

export interface SeedSummary {
  anchor: string;
  start: string;
  readingsPerInstallation: number;
  readingsGenerated: number;
  readingsInserted: number;
  hierarchy: Hierarchy;
}

/**
 * Idempotent seed: hierarchy rows use deterministic IDs with ON CONFLICT DO NOTHING; readings
 * rely on UNIQUE(installation_id, timestamp). Rerunning never duplicates or rewrites history.
 */
export async function seedDatabase(client: pg.ClientBase, cfg: SeedConfig): Promise<SeedSummary> {
  const log = cfg.log ?? (() => {});
  const anchorMs = floorToInterval(cfg.anchorMs);
  const perInstallation = (cfg.days * 24 * 60 * 60_000) / INTERVAL_MS;
  const startMs = anchorMs - perInstallation * INTERVAL_MS;
  const h = buildHierarchy({ randomSeed: cfg.randomSeed, installationCount: cfg.installationCount, anchorMs });

  await client.query('BEGIN');
  try {
    for (const p of h.provinces) {
      await client.query(
        'INSERT INTO provinces (id, code, name) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
        [p.id, p.code, p.name],
      );
    }
    for (const d of h.districts) {
      await client.query(
        'INSERT INTO districts (id, province_id, code, name) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
        [d.id, d.province_id, d.code, d.name],
      );
    }
    for (const s of h.substations) {
      await client.query(
        'INSERT INTO grid_substations (id, district_id, code, name) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING',
        [s.id, s.district_id, s.code, s.name],
      );
    }
    for (const i of h.installations) {
      await client.query(
        `INSERT INTO solar_installations (id, substation_id, meter_id, label, capacity_kw, commissioned_on, active)
         VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
        [i.id, i.substation_id, i.meter_id, i.label, i.capacity_kw, i.commissioned_on, i.active],
      );
    }
    for (const u of h.users) {
      await client.query(
        `INSERT INTO users (id, subject, display_name, role, province_id, district_id)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING`,
        [u.id, u.subject, u.display_name, u.role, u.province_id, u.district_id],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
  log(`Hierarchy: ${h.provinces.length} provinces, ${h.districts.length} districts, ${h.substations.length} substations, ${h.installations.length} installations, ${h.users.length} users`);

  const districtCode = new Map(h.districts.map((d) => [d.id, d.code]));
  const substationDistrict = new Map(h.substations.map((s) => [s.id, districtCode.get(s.district_id)!]));
  const batchSize = cfg.batchSize ?? 5000;
  let generated = 0;
  let inserted = 0;
  let buffer: ReturnType<typeof generateReadings> = [];

  const flush = async () => {
    if (buffer.length === 0) return;
    const res = await client.query(
      `INSERT INTO generation_readings
         (installation_id, "timestamp", power_kw, cumulative_energy_kwh, voltage_v, received_at)
       SELECT * FROM unnest($1::uuid[], $2::timestamptz[], $3::numeric[], $4::numeric[], $5::numeric[], $6::timestamptz[])
       ON CONFLICT (installation_id, "timestamp") DO NOTHING`,
      [
        buffer.map((r) => r.installation_id),
        buffer.map((r) => r.timestamp),
        buffer.map((r) => r.power_kw),
        buffer.map((r) => r.cumulative_energy_kwh),
        buffer.map((r) => r.voltage_v),
        buffer.map((r) => r.received_at),
      ],
    );
    inserted += res.rowCount ?? 0;
    buffer = [];
  };

  for (const inst of h.installations.filter((i) => i.reporting)) {
    const rows = generateReadings(
      { id: inst.id, capacity_kw: inst.capacity_kw, district_code: substationDistrict.get(inst.substation_id)! },
      startMs,
      perInstallation,
      cfg.randomSeed,
    );
    generated += rows.length;
    buffer.push(...rows);
    if (buffer.length >= batchSize) {
      await flush();
      log(`Readings: ${inserted}/${generated} inserted`);
    }
  }
  await flush();
  log(`Readings: ${inserted} inserted of ${generated} generated`);

  return {
    anchor: new Date(anchorMs).toISOString(),
    start: new Date(startMs).toISOString(),
    readingsPerInstallation: perInstallation,
    readingsGenerated: generated,
    readingsInserted: inserted,
    hierarchy: h,
  };
}
