import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, ids, READERS, type TestApp } from './app.js';

let t: TestApp;
const tokens: Partial<Record<keyof typeof READERS, string>> = {};
beforeAll(async () => {
  t = await buildTestApp();
  for (const k of Object.keys(READERS) as (keyof typeof READERS)[]) tokens[k] = await t.reader(k);
});
afterAll(async () => {
  await t.close();
});

const get = (who: keyof typeof READERS, path: string) =>
  request(t.app).get(`/solar/v1.0${path}`).set('Authorization', `Bearer ${tokens[who]}`);

async function countInDistrict(code: string): Promise<number> {
  const { rows } = await t.pool.query(
    `SELECT count(*)::int AS n FROM solar_installations i JOIN grid_substations s ON s.id = i.substation_id
     WHERE s.district_id = $1`,
    [ids.district(code)],
  );
  return rows[0].n;
}

describe('T02 installations collection', () => {
  it('national sees all 201 installations; counts are computed after scoping', async () => {
    const all = await get('national', '/installations?limit=100');
    expect(all.body.count).toBe(201);
    expect(all.body.data).toHaveLength(100);
    expect(all.body.next).toBe('/solar/v1.0/installations?limit=100&offset=100');
    const cmb = await get('cmb', '/installations');
    expect(cmb.body.count).toBe(await countInDistrict('CMB'));
  });

  it('filters by province, district and substation, and they intersect', async () => {
    const sub = await get(
      'national',
      `/installations?substation-id=${ids.substation('GSS-CMB-01')}`,
    );
    expect(
      sub.body.data.every(
        (i: { substation_id: string }) => i.substation_id === ids.substation('GSS-CMB-01'),
      ),
    ).toBe(true);
    const both = await get(
      'national',
      `/installations?district-id=${ids.district('CMB')}&substation-id=${ids.substation('GSS-CMB-01')}`,
    );
    expect(both.body.count).toBe(sub.body.count);
    const contradictory = await get(
      'national',
      `/installations?district-id=${ids.district('KDY')}&substation-id=${ids.substation('GSS-CMB-01')}`,
    );
    expect([contradictory.status, contradictory.body.error[0].field]).toEqual([
      400,
      'substation-id',
    ]);
  });

  it('a district reader filtering on another district gets an empty, link-free page', async () => {
    const res = await get('cmb', `/installations?district-id=${ids.district('KDY')}`);
    expect(res.body).toMatchObject({ data: [], count: 0, next: null, previous: null });
  });
});

describe('T02 installation atom', () => {
  it('returns typed metadata with Last-Modified and supports If-Modified-Since', async () => {
    const res = await get('national', `/installations/${ids.installation('MTR-000001')}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: ids.installation('MTR-000001'),
      meter_id: 'MTR-000001',
      active: true,
    });
    expect(typeof res.body.capacity_kw).toBe('number');
    expect(res.body.commissioned_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.body.updated_at).toMatch(/Z$/);
    expect(res.headers['last-modified']).toBe(new Date(res.body.updated_at).toUTCString());
    const cached = await get('national', `/installations/${ids.installation('MTR-000001')}`).set(
      'If-Modified-Since',
      res.headers['last-modified']!,
    );
    expect(cached.status).toBe(304);
  });

  it('hides installations outside the reader’s district', async () => {
    const { rows } = await t.pool.query(
      `SELECT i.id FROM solar_installations i JOIN grid_substations s ON s.id = i.substation_id WHERE s.district_id = $1 LIMIT 1`,
      [ids.district('KDY')],
    );
    expect((await get('cmb', `/installations/${rows[0].id}`)).status).toBe(404);
    expect((await get('kdy', `/installations/${rows[0].id}`)).status).toBe(200);
  });
});

describe('T02 substation-scoped installations', () => {
  it('lists installations for a visible substation and 404s a foreign one', async () => {
    const res = await get('cmb', `/grid-substations/${ids.substation('GSS-CMB-01')}/installations`);
    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThan(0);
    expect(
      (await get('cmb', `/grid-substations/${ids.substation('GSS-KDY-01')}/installations`)).status,
    ).toBe(404);
  });
});
