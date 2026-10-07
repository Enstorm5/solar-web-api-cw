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
const codes = (body: { data: { code: string }[] }) => body.data.map((s) => s.code).sort();

describe('T02 grid substations collection', () => {
  it('national sees all 30; province and district filters narrow', async () => {
    expect((await get('national', '/grid-substations')).body.count).toBe(30);
    // WP: CMB (2) + GMP (2) + KLT (1)
    expect((await get('national', `/grid-substations?province-id=${ids.province('WP')}`)).body.count).toBe(5);
    expect(codes((await get('national', `/grid-substations?district-id=${ids.district('CMB')}`)).body)).toEqual([
      'GSS-CMB-01',
      'GSS-CMB-02',
    ]);
  });

  it('scopes the district reader to its own district', async () => {
    expect(codes((await get('cmb', '/grid-substations')).body)).toEqual(['GSS-CMB-01', 'GSS-CMB-02']);
  });

  it('400 for contradictory visible filters; empty result for a foreign filter', async () => {
    const bad = await get('national', `/grid-substations?province-id=${ids.province('CP')}&district-id=${ids.district('CMB')}`);
    expect([bad.status, bad.body.code, bad.body.error[0].field]).toEqual([400, 1003, 'district-id']);
    const foreign = await get('cmb', `/grid-substations?province-id=${ids.province('CP')}&district-id=${ids.district('KDY')}`);
    expect([foreign.status, foreign.body.count]).toEqual([200, 0]);
  });
});

describe('T02 grid substation atom and district-scoped collection', () => {
  it('returns visible substations and 404 for foreign ones', async () => {
    const own = await get('cmb', `/grid-substations/${ids.substation('GSS-CMB-02')}`);
    expect(own.body).toEqual({
      id: ids.substation('GSS-CMB-02'),
      district_id: ids.district('CMB'),
      code: 'GSS-CMB-02',
      name: 'Colombo Grid Substation 2 (synthetic)',
    });
    expect((await get('cmb', `/grid-substations/${ids.substation('GSS-GMP-01')}`)).status).toBe(404);
  });

  it('lists substations under a visible district; foreign parent is 404', async () => {
    expect((await get('wp', `/districts/${ids.district('GMP')}/grid-substations`)).body.count).toBe(2);
    expect((await get('wp', `/districts/${ids.district('KDY')}/grid-substations`)).status).toBe(404);
  });
});
