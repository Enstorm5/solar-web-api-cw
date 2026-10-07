import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { seedUuid } from '../../src/seed/generate.js';
import { buildTestApp, ids, type TestApp } from './app.js';

// Fixture district TST (in Western Province) with seven sites reproducing the hand-calculated
// unit-test case end to end. Created and removed with the owner connection.
const D = seedUuid('fixture:district:TST');
const SUB = seedUuid('fixture:substation:TST');
const site = (k: string) => seedUuid(`fixture:installation:${k}`);
const AS_OF = '2026-09-25T06:30:00Z'; // 12:00 Asia/Colombo
const START = '2026-09-24T18:30:00Z'; // local midnight

let owner: pg.Client;
let t: TestApp;
let national: string;

const readings: Array<[string, string, number, number]> = [
  // site, timestamp, power_kw, cumulative_energy_kwh
  ['A', START, 0, 100],
  ['A', AS_OF, 4, 112.5],
  ['B', '2026-09-24T18:20:00Z', 0, 50],
  ['B', '2026-09-25T06:20:00Z', 2.5, 58],
  ['C', START, 0, 10],
  ['C', '2026-09-25T05:30:00Z', 1, 15],
  ['D', START, 0, 900],
  ['D', '2026-09-25T00:00:00Z', 1, 950],
  ['D', '2026-09-25T03:00:00Z', 2, 5],
  ['D', AS_OF, 3, 20],
  ['E', START, 0, 200],
  ['E', '2026-09-25T01:00:00Z', 1, 300],
  ['E', '2026-09-25T02:00:00Z', 1, 1],
  ['E', AS_OF, 0, 250],
  ['G', '2026-09-25T01:00:00Z', 1, 0],
  ['G', AS_OF, 1.5, 5],
];

async function cleanup() {
  await owner.query(
    'ALTER TABLE generation_readings DISABLE TRIGGER generation_readings_no_update_delete',
  );
  try {
    await owner.query(
      `DELETE FROM generation_readings WHERE installation_id IN (SELECT id FROM solar_installations WHERE substation_id = $1)`,
      [SUB],
    );
  } finally {
    await owner.query(
      'ALTER TABLE generation_readings ENABLE TRIGGER generation_readings_no_update_delete',
    );
  }
  await owner.query('DELETE FROM solar_installations WHERE substation_id = $1', [SUB]);
  await owner.query('DELETE FROM grid_substations WHERE id = $1', [SUB]);
  await owner.query('DELETE FROM districts WHERE id = $1', [D]);
}

beforeAll(async () => {
  owner = new pg.Client({ connectionString: inject('databaseUrl') });
  await owner.connect();
  await cleanup();
  await owner.query(
    `INSERT INTO districts (id, province_id, code, name) VALUES ($1, $2, 'TST', 'Fixture District')`,
    [D, ids.province('WP')],
  );
  await owner.query(
    `INSERT INTO grid_substations (id, district_id, code, name) VALUES ($1, $2, 'GSS-TST-01', 'Fixture GSS')`,
    [SUB, D],
  );
  for (const k of ['A', 'B', 'C', 'D', 'E', 'F', 'G']) {
    await owner.query(
      `INSERT INTO solar_installations (id, substation_id, meter_id, label, capacity_kw, commissioned_on)
       VALUES ($1, $2, $3, 'Fixture site', 5, '2026-01-01')`,
      [site(k), SUB, `FIX-${k}`],
    );
  }
  for (const [k, ts, p, e] of readings) {
    await owner.query(
      `INSERT INTO generation_readings (installation_id, "timestamp", power_kw, cumulative_energy_kwh, voltage_v)
       VALUES ($1, $2, $3, $4, 230)`,
      [site(k), ts, p, e],
    );
  }
  t = await buildTestApp();
  national = await t.reader('national');
});
afterAll(async () => {
  await cleanup();
  await owner.end();
  await t.close();
});

const summary = (district: string, q: string, token = national) =>
  request(t.app)
    .get(`/solar/v1.0/districts/${district}/generation-summary${q}`)
    .set('Authorization', `Bearer ${token}`);

describe('T11 district generation summary', () => {
  it('matches the hand-calculated fixture end to end', async () => {
    const res = await summary(D, `?date=2026-09-25&as-of=${AS_OF}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      district_id: D,
      date: '2026-09-25',
      timezone: 'Asia/Colombo',
      as_of: '2026-09-25T06:30:00.000Z',
      period_start: '2026-09-24T18:30:00.000Z',
      period_end: '2026-09-25T06:30:00.000Z',
      freshness_seconds: 1800,
      max_boundary_age_seconds: 900,
      current_power_kw: 11,
      estimated_energy_kwh: 20.5,
      installation_count: 7,
      fresh_installation_count: 5,
      stale_installation_count: 1,
      missing_installation_count: 1,
      energy_covered_installation_count: 2,
      energy_incomplete_installation_count: 5,
      meter_reset_installation_count: 2,
    });
  });

  it('derives the date from as-of in Asia/Colombo and accepts an offset as-of', async () => {
    const res = await summary(D, `?as-of=2026-09-25T12:00:00%2B05:30`);
    expect(res.body).toMatchObject({
      date: '2026-09-25',
      as_of: '2026-09-25T06:30:00.000Z',
      estimated_energy_kwh: 20.5,
    });
  });

  it('cross-checks a seeded full day against an independent SQL calculation', async () => {
    const anchor = inject('seedAnchor'); // 2026-10-01T00:00Z
    const res = await summary(ids.district('CMB'), `?date=2026-09-30&as-of=${anchor}`);
    expect(res.status).toBe(200);
    const { rows } = await owner.query(
      `SELECT count(*)::int AS n, round(sum(e.cumulative_energy_kwh - s.cumulative_energy_kwh), 3)::float AS energy
         FROM solar_installations i
         JOIN grid_substations g ON g.id = i.substation_id
         JOIN generation_readings s ON s.installation_id = i.id AND s."timestamp" = '2026-09-29T18:30:00Z'
         JOIN generation_readings e ON e.installation_id = i.id AND e."timestamp" = '2026-09-30T18:30:00Z'
        WHERE g.district_id = $1`,
      [ids.district('CMB')],
    );
    expect(res.body.period_end).toBe('2026-09-30T18:30:00.000Z');
    expect(res.body.energy_covered_installation_count).toBe(rows[0].n);
    expect(res.body.estimated_energy_kwh).toBeCloseTo(rows[0].energy, 3);
    // 05:15 local at as-of: every site reported 15 min earlier (fresh) and generates nothing at night.
    expect(res.body.fresh_installation_count).toBe(res.body.installation_count);
    expect(res.body.current_power_kw).toBe(0);
  });

  it('is scoped: a district reader cannot see another district’s summary (404)', async () => {
    const res = await summary(ids.district('KDY'), `?as-of=${AS_OF}`, await t.reader('cmb'));
    expect(res.status).toBe(404);
    expect(
      (await summary(ids.district('CMB'), `?as-of=${AS_OF}`, await t.reader('cmb'))).status,
    ).toBe(200);
  });

  it('supports conditional GET within the same evaluation bucket', async () => {
    const first = await summary(D, `?date=2026-09-25&as-of=${AS_OF}`);
    const again = await summary(D, `?date=2026-09-25&as-of=${AS_OF}`).set(
      'If-None-Match',
      first.headers.etag!,
    );
    expect(again.status).toBe(304);
    const later = await summary(D, `?date=2026-09-25&as-of=2026-09-25T06:45:00Z`).set(
      'If-None-Match',
      first.headers.etag!,
    );
    expect(later.status).toBe(200);
  });

  it('400 for a future as-of, a day not yet started, or malformed values', async () => {
    const future = await summary(D, `?as-of=${new Date(Date.now() + 3_600_000).toISOString()}`);
    expect([future.status, future.body.error[0].field]).toEqual([400, 'as-of']);
    const notStarted = await summary(D, `?date=2026-09-26&as-of=${AS_OF}`);
    expect([notStarted.status, notStarted.body.error[0].field]).toEqual([400, 'date']);
    expect((await summary(D, '?date=25-09-2026')).status).toBe(400);
    expect((await summary(D, '?district=x')).status).toBe(400);
  });

  it('devices cannot read the summary (403)', async () => {
    expect((await summary(D, '', await t.device('MTR-000001'))).status).toBe(403);
  });
});
