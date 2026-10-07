import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildTestApp, ids, type TestApp } from './app.js';

const METER = 'MTR-000150';
const OTHER_METER = 'MTR-000151';
let t: TestApp;
let deviceToken: string;
let installationId: string;
let districtId: string;

beforeAll(async () => {
  t = await buildTestApp();
  deviceToken = await t.device(METER);
  installationId = ids.installation(METER);
  const { rows } = await t.pool.query(
    'SELECT s.district_id FROM solar_installations i JOIN grid_substations s ON s.id = i.substation_id WHERE i.id = $1',
    [installationId],
  );
  districtId = rows[0].district_id;
});
afterAll(async () => {
  await t.close();
});

// Distinct, recent observation times per test so runs never collide with each other or the seed.
let minuteOffset = 0;
const recentTimestamp = () => {
  minuteOffset += 1;
  const t0 = Math.floor(Date.now() / 60_000) * 60_000 - 60 * 60_000;
  return new Date(t0 + minuteOffset * 60_000).toISOString();
};
const body = (over: Record<string, unknown> = {}) => ({
  timestamp: recentTimestamp(),
  power_kw: 3.25,
  cumulative_energy_kwh: 99_000.5,
  voltage_v: 230.4,
  ...over,
});
const post = (token: string, payload: unknown, id = installationId) =>
  request(t.app)
    .post(`/solar/v1.0/installations/${id}/readings`)
    .set('Authorization', `Bearer ${token}`)
    .send(payload as object);

describe('T03 device ingestion', () => {
  it('201 with Location, Content-Location, ETag, Last-Modified and the created representation', async () => {
    const payload = body();
    const res = await post(deviceToken, payload);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      installation_id: installationId,
      timestamp: payload.timestamp,
      power_kw: 3.25,
      cumulative_energy_kwh: 99_000.5,
      voltage_v: 230.4,
    });
    expect(res.headers.location).toBe(
      `/solar/v1.0/installations/${installationId}/readings/${res.body.id}`,
    );
    expect(res.headers['content-location']).toBe(res.headers.location);
    expect(res.headers.etag).toBeTruthy();
    expect(res.headers['last-modified']).toBe(new Date(res.body.received_at).toUTCString());
  });

  it('a reader in the installation’s jurisdiction can GET the Location; others get 404; the device cannot read', async () => {
    const created = await post(deviceToken, body());
    const loc = created.headers.location!;
    const district = await t.token('user', 'analyst-national', 'analyst-read-national');
    const read = await request(t.app).get(loc).set('Authorization', `Bearer ${district}`);
    expect(read.status).toBe(200);
    expect(read.body).toEqual(created.body);
    expect(read.headers.etag).toBe(created.headers.etag);

    const { rows } = await t.pool.query('SELECT code FROM districts WHERE id = $1', [districtId]);
    const outsider = rows[0].code === 'CMB' ? await t.reader('kdy') : await t.reader('cmb');
    expect((await request(t.app).get(loc).set('Authorization', `Bearer ${outsider}`)).status).toBe(
      404,
    );
    expect(
      (await request(t.app).get(loc).set('Authorization', `Bearer ${deviceToken}`)).status,
    ).toBe(403);
  });

  it('a reading is only addressable through its own installation', async () => {
    const created = await post(deviceToken, body());
    const national = await t.reader('national');
    const wrongParent = `/solar/v1.0/installations/${ids.installation(OTHER_METER)}/readings/${created.body.id}`;
    expect(
      (await request(t.app).get(wrongParent).set('Authorization', `Bearer ${national}`)).status,
    ).toBe(404);
  });

  it('another device or any analyst cannot write this installation’s readings (403)', async () => {
    const other = await post(await t.device(OTHER_METER), body());
    expect([other.status, other.body.code]).toEqual([403, 1020]);
    const analyst = await post(await t.reader('national'), body());
    expect([analyst.status, analyst.body.code]).toEqual([403, 1020]);
  });

  it('409 on a duplicate timestamp and history is never overwritten', async () => {
    const payload = body();
    expect((await post(deviceToken, payload)).status).toBe(201);
    const dup = await post(deviceToken, { ...payload, power_kw: 9.99 });
    expect([dup.status, dup.body.code]).toEqual([409, 1060]);
    const { rows } = await t.pool.query(
      'SELECT power_kw FROM generation_readings WHERE installation_id = $1 AND "timestamp" = $2',
      [installationId, payload.timestamp],
    );
    expect(rows).toEqual([{ power_kw: 3.25 }]);
  });

  it('concurrent retries of the same reading insert exactly once', async () => {
    const payload = body();
    const results = await Promise.all(Array.from({ length: 6 }, () => post(deviceToken, payload)));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409, 409, 409, 409]);
  });

  it('accepts a late (older) observation as normal history', async () => {
    const res = await post(deviceToken, body({ timestamp: '2026-09-15T06:00:00Z' }));
    expect(res.status).toBe(201);
  });
});

describe('T03/T10 ingestion validation', () => {
  it.each([
    ['negative power', { power_kw: -1 }, 'power_kw'],
    ['voltage out of range', { voltage_v: 1200 }, 'voltage_v'],
    ['numeric string', { cumulative_energy_kwh: '12' }, 'cumulative_energy_kwh'],
    ['timestamp without zone', { timestamp: '2026-10-07T06:00:00' }, 'timestamp'],
    [
      'far-future timestamp',
      { timestamp: new Date(Date.now() + 3_600_000).toISOString() },
      'timestamp',
    ],
    ['client-supplied id', { id: '00000000-0000-0000-0000-000000000000' }, undefined],
    ['client-supplied installation', { installation_id: ids.installation(OTHER_METER) }, undefined],
  ])('400 for %s', async (_name, over, field) => {
    const res = await post(deviceToken, body(over));
    expect([res.status, res.body.code]).toEqual([400, 1001]);
    if (field) expect(res.body.error.map((e: { field?: string }) => e.field)).toContain(field);
  });

  it('400 when a required field is missing', async () => {
    const rest: Record<string, unknown> = body();
    delete rest.voltage_v;
    const res = await post(deviceToken, rest);
    expect(res.body.error[0]).toMatchObject({ field: 'voltage_v' });
  });

  it('400 malformed JSON, 415 non-JSON body', async () => {
    const malformed = await request(t.app)
      .post(`/solar/v1.0/installations/${installationId}/readings`)
      .set('Authorization', `Bearer ${deviceToken}`)
      .set('Content-Type', 'application/json')
      .send('{"timestamp":');
    expect([malformed.status, malformed.body.code]).toEqual([400, 1002]);
    const text = await request(t.app)
      .post(`/solar/v1.0/installations/${installationId}/readings`)
      .set('Authorization', `Bearer ${deviceToken}`)
      .set('Content-Type', 'text/plain')
      .send('power=3');
    expect([text.status, text.body.code]).toEqual([415, 1090]);
  });

  it('405 with Allow for attempts to modify or delete a reading', async () => {
    const created = await post(deviceToken, body());
    for (const method of ['put', 'patch', 'delete'] as const) {
      const agent = request(t.app);
      const res = await agent[method](created.headers.location!).set(
        'Authorization',
        `Bearer ${deviceToken}`,
      );
      expect(res.status).toBe(405);
      expect(res.headers.allow).toBe('GET, HEAD');
    }
  });

  it('401 for a deactivated installation’s device token', async () => {
    const owner = new pg.Client({ connectionString: inject('databaseUrl') });
    await owner.connect();
    try {
      await owner.query('UPDATE solar_installations SET active = false WHERE id = $1', [
        installationId,
      ]);
      const res = await post(deviceToken, body());
      expect([res.status, res.body.code]).toEqual([401, 1011]);
    } finally {
      await owner.query('UPDATE solar_installations SET active = true WHERE id = $1', [
        installationId,
      ]);
      await owner.end();
    }
  });
});
