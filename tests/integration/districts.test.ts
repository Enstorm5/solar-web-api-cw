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

describe('T02 districts collection', () => {
  it('national reader sees all 25 districts, filterable by province', async () => {
    expect((await get('national', '/districts')).body.count).toBe(25);
    const np = await get('national', `/districts?province-id=${ids.province('NP')}`);
    expect(np.body.count).toBe(5);
    expect(np.body.data.every((d: { province_id: string }) => d.province_id === ids.province('NP'))).toBe(true);
  });

  it('scopes provincial and district readers', async () => {
    const wp = await get('wp', '/districts');
    expect(wp.body.data.map((d: { code: string }) => d.code).sort()).toEqual(['CMB', 'GMP', 'KLT']);
    const cmb = await get('cmb', '/districts');
    expect(cmb.body).toMatchObject({ count: 1, data: [{ code: 'CMB' }] });
  });

  it('a filter outside the caller’s jurisdiction narrows to an empty page, never widens', async () => {
    const res = await get('cmb', `/districts?province-id=${ids.province('CP')}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: [], count: 0, limit: 50, offset: 0, next: null, previous: null });
  });

  it('preserves the filter in pagination links', async () => {
    const res = await get('national', `/districts?province-id=${ids.province('NP')}&limit=2&offset=2`);
    expect(res.body.next).toBe(`/solar/v1.0/districts?province-id=${ids.province('NP')}&limit=2&offset=4`);
    expect(res.body.previous).toBe(`/solar/v1.0/districts?province-id=${ids.province('NP')}&limit=2&offset=0`);
  });

  it('rejects malformed filters', async () => {
    const res = await get('national', '/districts?province-id=WP');
    expect([res.status, res.body.error[0].field]).toEqual([400, 'province-id']);
  });
});

describe('T02 district atom', () => {
  it('returns a visible district and hides foreign ones as 404', async () => {
    const own = await get('wp', `/districts/${ids.district('GMP')}`);
    expect(own.body).toEqual({ id: ids.district('GMP'), province_id: ids.province('WP'), code: 'GMP', name: 'Gampaha' });
    expect((await get('wp', `/districts/${ids.district('KDY')}`)).status).toBe(404);
    expect((await get('cmb', `/districts/${ids.district('GMP')}`)).status).toBe(404);
    expect((await get('kdy', `/districts/${ids.district('KDY')}`)).status).toBe(200);
  });
});

describe('T02 province-scoped districts', () => {
  it('lists districts of a visible province, intersected with the reader’s scope', async () => {
    expect((await get('national', `/provinces/${ids.province('WP')}/districts`)).body.count).toBe(3);
    const cmb = await get('cmb', `/provinces/${ids.province('WP')}/districts`);
    expect(cmb.body).toMatchObject({ count: 1, data: [{ code: 'CMB' }] });
  });

  it('404 for a foreign or unknown parent rather than an empty list', async () => {
    const foreign = await get('cmb', `/provinces/${ids.province('CP')}/districts`);
    expect([foreign.status, foreign.body.code]).toEqual([404, 1030]);
    expect((await get('national', `/provinces/${ids.district('CMB')}/districts`)).status).toBe(404);
  });

  it('supports conditional GET on the scoped collection', async () => {
    const first = await get('national', `/provinces/${ids.province('NP')}/districts`);
    const again = await get('national', `/provinces/${ids.province('NP')}/districts`).set('If-None-Match', first.headers.etag!);
    expect(again.status).toBe(304);
  });
});
