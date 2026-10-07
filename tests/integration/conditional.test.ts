import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, ids, type TestApp } from './app.js';

let t: TestApp;
let national: string;
let kandy: string;
let site: string;
let readingPath: string;

beforeAll(async () => {
  t = await buildTestApp();
  national = await t.reader('national');
  kandy = await t.reader('kdy');
  // An installation in Colombo, so the Kandy reader is an outsider for every URI below.
  const { rows } = await t.pool.query(
    `SELECT i.id FROM solar_installations i JOIN grid_substations s ON s.id = i.substation_id
     WHERE s.district_id = $1 ORDER BY i.meter_id LIMIT 1`,
    [ids.district('CMB')],
  );
  site = rows[0].id;
  const latest = await request(t.app)
    .get(`/solar/v1.0/installations/${site}/last-known-reading`)
    .set('Authorization', `Bearer ${national}`);
  readingPath = latest.body.reading_uri.replace('/solar/v1.0', '');
});
afterAll(async () => {
  await t.close();
});

const get = (path: string, token: string, headers: Record<string, string> = {}) =>
  request(t.app).get(`/solar/v1.0${path}`).set('Authorization', `Bearer ${token}`).set(headers);

const colomboResources = () => [
  `/provinces/${ids.province('WP')}`,
  `/provinces/${ids.province('WP')}/districts`,
  `/districts/${ids.district('CMB')}`,
  `/districts/${ids.district('CMB')}/grid-substations`,
  `/grid-substations/${ids.substation('GSS-CMB-01')}`,
  `/grid-substations/${ids.substation('GSS-CMB-01')}/installations`,
  `/installations/${site}`,
  `/installations/${site}/overview`,
  `/installations/${site}/last-known-reading`,
  `/installations/${site}/readings?from=2026-09-30T00:00:00Z&to=2026-10-01T00:00:00Z`,
  readingPath,
];
const collections = [
  '/provinces',
  '/districts',
  '/grid-substations',
  '/installations',
  `/readings?district-id=${ids.district('CMB')}&limit=5`,
];

describe('T07 conditional GET on every retrievable resource', () => {
  it.each([...collections, '__colombo__'])('%s: 200 then 304 with an empty body', async (path) => {
    const paths = path === '__colombo__' ? colomboResources() : [path];
    for (const p of paths) {
      const first = await get(p, national);
      expect(first.status, p).toBe(200);
      expect(first.headers.etag, p).toMatch(/^"[A-Za-z0-9_-]+"$/);
      expect(first.headers['cache-control'], p).toBe('private, no-cache');
      expect(first.headers.vary, p).toBe('Authorization, Accept');
      const again = await get(p, national, { 'If-None-Match': first.headers.etag! });
      expect(again.status, p).toBe(304);
      expect(again.text, p).toBe('');
      expect(again.headers['content-length'] ?? '0', p).toBe('0');
      expect(again.headers.etag, p).toBe(first.headers.etag);
    }
  });

  it('a stale validator gets the full representation', async () => {
    const res = await get('/provinces', national, { 'If-None-Match': '"stale"' });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(9);
  });

  it('changing the query changes the validator', async () => {
    const a = await get('/districts?limit=5', national);
    const b = await get('/districts?limit=6', national);
    expect(a.headers.etag).not.toBe(b.headers.etag);
    expect(
      (await get('/districts?limit=6', national, { 'If-None-Match': a.headers.etag! })).status,
    ).toBe(200);
  });
});

describe('T07/T09 conditional requests never bypass authorisation', () => {
  it('an outsider presenting a valid ETag gets 404, not 304', async () => {
    for (const p of colomboResources().filter((x) => !x.startsWith('/provinces'))) {
      const owner = await get(p, national);
      const res = await get(p, kandy, { 'If-None-Match': owner.headers.etag! });
      expect(res.status, p).toBe(404);
    }
  });

  it('a wildcard If-None-Match from an outsider still gets 404', async () => {
    expect((await get(`/installations/${site}`, kandy, { 'If-None-Match': '*' })).status).toBe(404);
  });

  it('no token plus a valid ETag is 401, not 304', async () => {
    const owner = await get(`/installations/${site}`, national);
    const res = await request(t.app)
      .get(`/solar/v1.0/installations/${site}`)
      .set('If-None-Match', owner.headers.etag!);
    expect(res.status).toBe(401);
  });
});
