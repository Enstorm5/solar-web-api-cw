import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildTestApp, ids, type TestApp } from './app.js';

let t: TestApp;
let national: string;
beforeAll(async () => {
  t = await buildTestApp();
  national = await t.reader('national');
});
afterAll(async () => {
  await t.close();
});

const get = (path: string, token = national) =>
  request(t.app).get(`/solar/v1.0${path}`).set('Authorization', `Bearer ${token}`);

describe('T06 installation overview (composite)', () => {
  it('embeds the installation, its hierarchy and the latest observation', async () => {
    const id = ids.installation('MTR-000001');
    const res = await get(`/installations/${id}/overview`);
    expect(res.status).toBe(200);
    const atom = await get(`/installations/${id}`);
    expect(res.body.installation).toEqual(atom.body);
    expect(res.body.grid_substation.id).toBe(atom.body.substation_id);
    expect(res.body.district.id).toBe(res.body.grid_substation.district_id);
    expect(res.body.province.id).toBe(res.body.district.province_id);
    // Seed anchor is exclusive, so the newest seeded observation is 15 minutes before it.
    const newest = new Date(Date.parse(inject('seedAnchor')) - 15 * 60_000).toISOString();
    expect(res.body.last_known_reading).toMatchObject({ installation_id: id, timestamp: newest });
    expect(Object.keys(res.body).sort()).toEqual([
      'district',
      'grid_substation',
      'installation',
      'last_known_reading',
      'province',
    ]);
    expect(res.headers['last-modified']).toBeUndefined();
  });

  it('uses null (not an invented zero) when the installation has never reported', async () => {
    const res = await get(`/installations/${ids.installation('MTR-000201')}/overview`);
    expect(res.status).toBe(200);
    expect(res.body.last_known_reading).toBeNull();
  });

  it('is scoped like every other read', async () => {
    const id = ids.installation('MTR-000001');
    const { rows } = await t.pool.query(
      `SELECT d.code FROM solar_installations i JOIN grid_substations s ON s.id = i.substation_id
       JOIN districts d ON d.id = s.district_id WHERE i.id = $1`,
      [id],
    );
    const outsider = await t.reader(rows[0].code === 'CMB' ? 'kdy' : 'cmb');
    expect((await get(`/installations/${id}/overview`, outsider)).status).toBe(404);
    expect((await get(`/installations/${id}/last-known-reading`, outsider)).status).toBe(404);
  });
});

describe('T06 last-known reading (derived)', () => {
  it('returns the newest observation with its canonical URI', async () => {
    const id = ids.installation('MTR-000001');
    const res = await get(`/installations/${id}/last-known-reading`);
    expect(res.status).toBe(200);
    expect(res.body.reading_uri).toBe(`/solar/v1.0/installations/${id}/readings/${res.body.id}`);
    expect(res.headers['content-location']).toBe(res.body.reading_uri);
    const canonical = await get(res.body.reading_uri.replace('/solar/v1.0', ''));
    expect({ ...canonical.body, reading_uri: res.body.reading_uri }).toEqual(res.body);
  });

  it('404 with a clear message for an installation that has never reported', async () => {
    const res = await get(`/installations/${ids.installation('MTR-000201')}/last-known-reading`);
    expect([res.status, res.body.code]).toEqual([404, 1030]);
    expect(res.body.message).toMatch(/not reported/);
  });

  it('ignores late older observations and moves on newer ones (validators follow)', async () => {
    const meter = 'MTR-000153';
    const id = ids.installation(meter);
    const device = await t.device(meter);
    const post = (timestamp: string) =>
      request(t.app)
        .post(`/solar/v1.0/installations/${id}/readings`)
        .set('Authorization', `Bearer ${device}`)
        .send({ timestamp, power_kw: 2, cumulative_energy_kwh: 70_000, voltage_v: 231 });

    const before = await get(`/installations/${id}/last-known-reading`);
    const overviewBefore = await get(`/installations/${id}/overview`);

    expect((await post('2026-09-01T06:00:00Z')).status).toBe(201); // late, older than anything seeded
    const afterLate = await get(`/installations/${id}/last-known-reading`).set(
      'If-None-Match',
      before.headers.etag!,
    );
    expect(afterLate.status).toBe(304);

    const newer = new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString();
    const created = await post(newer);
    expect(created.status).toBe(201);
    const afterNew = await get(`/installations/${id}/last-known-reading`).set(
      'If-None-Match',
      before.headers.etag!,
    );
    expect(afterNew.status).toBe(200);
    expect(afterNew.body.id).toBe(created.body.id);
    const overviewAfter = await get(`/installations/${id}/overview`).set(
      'If-None-Match',
      overviewBefore.headers.etag!,
    );
    expect(overviewAfter.status).toBe(200);
    expect(overviewAfter.body.last_known_reading.id).toBe(created.body.id);
  });

  it('devices cannot read operational state', async () => {
    const res = await get(
      `/installations/${ids.installation('MTR-000001')}/last-known-reading`,
      await t.device('MTR-000001'),
    );
    expect(res.status).toBe(403);
  });
});
