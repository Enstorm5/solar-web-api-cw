import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, ids, READERS, type TestApp } from './app.js';

// MTR-000001 holds only seeded history (ingestion tests use MTR-000150/151).
const SITE = 'MTR-000001';
let t: TestApp;
const tokens: Partial<Record<keyof typeof READERS, string>> = {};
let siteDistrictCode: string;
beforeAll(async () => {
  t = await buildTestApp();
  for (const k of Object.keys(READERS) as (keyof typeof READERS)[]) tokens[k] = await t.reader(k);
  const { rows } = await t.pool.query(
    `SELECT d.code FROM solar_installations i JOIN grid_substations s ON s.id = i.substation_id
     JOIN districts d ON d.id = s.district_id WHERE i.id = $1`,
    [ids.installation(SITE)],
  );
  siteDistrictCode = rows[0].code;
});
afterAll(async () => {
  await t.close();
});

const get = (who: keyof typeof READERS, path: string) =>
  request(t.app).get(`/solar/v1.0${path}`).set('Authorization', `Bearer ${tokens[who]}`);
const history = (q: string, who: keyof typeof READERS = 'national') =>
  get(who, `/installations/${ids.installation(SITE)}/readings${q}`);
type R = { id: string; timestamp: string; installation_id: string };

describe('T04 installation history', () => {
  it('applies an inclusive `from` and exclusive `to`', async () => {
    const res = await history('?from=2026-09-30T00:00:00Z&to=2026-09-30T01:00:00Z&sort=timestamp');
    expect(res.body.count).toBe(4);
    expect(res.body.data.map((r: R) => r.timestamp)).toEqual([
      '2026-09-30T00:00:00.000Z',
      '2026-09-30T00:15:00.000Z',
      '2026-09-30T00:30:00.000Z',
      '2026-09-30T00:45:00.000Z',
    ]);
  });

  it('accepts explicit offsets (+05:30 must be URL-encoded) equal to the UTC instant', async () => {
    const res = await history('?from=2026-09-30T05:30:00%2B05:30&to=2026-09-30T06:30:00%2B05:30');
    expect(res.body.count).toBe(4);
  });

  it('sorts descending by default and ascending on request', async () => {
    const desc = await history('?from=2026-09-30T00:00:00Z&to=2026-09-30T01:00:00Z');
    expect(desc.body.data[0].timestamp).toBe('2026-09-30T00:45:00.000Z');
    const explicit = await history(
      '?from=2026-09-30T00:00:00Z&to=2026-09-30T01:00:00Z&sort=-timestamp',
    );
    expect(explicit.body.data).toEqual(desc.body.data);
    const asc = await history('?from=2026-09-30T00:00:00Z&to=2026-09-30T01:00:00Z&sort=timestamp');
    expect(asc.body.data).toEqual([...desc.body.data].reverse());
  });

  it('pages through the full week with count, next and previous', async () => {
    const first = await history('?limit=100');
    expect(first.body).toMatchObject({ count: 768, limit: 100, offset: 0, previous: null });
    expect(first.body.next).toBe(
      `/solar/v1.0/installations/${ids.installation(SITE)}/readings?sort=-timestamp&limit=100&offset=100`,
    );
    const last = await history('?limit=100&offset=700');
    expect(last.body.data).toHaveLength(68);
    expect(last.body.next).toBeNull();
    expect(last.body.previous).toContain('offset=600');
    const beyond = await history('?limit=100&offset=5000');
    expect(beyond.body).toMatchObject({ data: [], count: 768, next: null });
    expect(beyond.body.previous).toContain('offset=700');
  });

  it('pages are contiguous and non-overlapping', async () => {
    const a = await history('?limit=30&offset=0&sort=timestamp');
    const b = await history('?limit=30&offset=30&sort=timestamp');
    const both = await history('?limit=60&offset=0&sort=timestamp');
    expect([...a.body.data, ...b.body.data]).toEqual(both.body.data);
  });

  it('preserves URL-encoded filters in links', async () => {
    const res = await history('?from=2026-09-29T00:00:00Z&limit=10');
    expect(res.body.next).toContain('from=2026-09-29T00%3A00%3A00Z');
    expect(res.body.next).toContain('sort=-timestamp');
  });

  it('returns an empty envelope for an installation that has never reported', async () => {
    const res = await get('national', `/installations/${ids.installation('MTR-000201')}/readings`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: [],
      count: 0,
      limit: 50,
      offset: 0,
      next: null,
      previous: null,
    });
  });

  it('404 for an installation outside the reader’s jurisdiction', async () => {
    const outsider = siteDistrictCode === 'CMB' ? 'kdy' : 'cmb';
    expect((await history('', outsider)).status).toBe(404);
  });

  it.each([
    ['to before from', '?from=2026-09-30T01:00:00Z&to=2026-09-30T00:00:00Z', 'to'],
    ['equal bounds', '?from=2026-09-30T01:00:00Z&to=2026-09-30T01:00:00Z', 'to'],
    ['unsupported sort', '?sort=power_kw', 'sort'],
    ['limit above 100', '?limit=101', 'limit'],
    ['negative offset', '?offset=-1', 'offset'],
    ['zone-less time', '?from=2026-09-30T00:00:00', 'from'],
    ['unknown parameter', '?province-id=x', undefined],
  ])('400 for %s', async (_n, q, field) => {
    const res = await history(q);
    expect([res.status, res.body.code]).toEqual([400, 1003]);
    if (field) expect(res.body.error[0].field).toBe(field);
  });
});

describe('T05 regional readings', () => {
  async function sqlCount(where: string, params: unknown[]): Promise<number> {
    const { rows } = await t.pool.query(
      `SELECT count(*)::int AS n FROM generation_readings r JOIN solar_installations i ON i.id = r.installation_id
       JOIN grid_substations s ON s.id = i.substation_id JOIN districts d ON d.id = s.district_id ${where}`,
      params,
    );
    return rows[0].n;
  }

  it('counts match an independent SQL count for each geography filter', async () => {
    const window = 'from=2026-09-30T00:00:00Z&to=2026-10-01T00:00:00Z';
    const w = `r."timestamp" >= '2026-09-30T00:00:00Z' AND r."timestamp" < '2026-10-01T00:00:00Z'`;
    const p = await get('national', `/readings?province-id=${ids.province('CP')}&${window}`);
    expect(p.body.count).toBe(
      await sqlCount(`WHERE d.province_id = $1 AND ${w}`, [ids.province('CP')]),
    );
    const d = await get('national', `/readings?district-id=${ids.district('JAF')}&${window}`);
    expect(d.body.count).toBe(await sqlCount(`WHERE d.id = $1 AND ${w}`, [ids.district('JAF')]));
    const s = await get(
      'national',
      `/readings?substation-id=${ids.substation('GSS-GAL-02')}&${window}`,
    );
    expect(s.body.count).toBe(
      await sqlCount(`WHERE s.id = $1 AND ${w}`, [ids.substation('GSS-GAL-02')]),
    );
    expect(s.body.count).toBeGreaterThan(0);
  });

  it('national unfiltered count (join-free path) equals the total number of readings', async () => {
    const res = await get('national', '/readings?limit=1');
    const { rows } = await t.pool.query('SELECT count(*)::int AS n FROM generation_readings');
    expect(res.body.count).toBe(rows[0].n);
  });

  it('scopes a district reader before counting, and filters cannot widen it', async () => {
    const own = await get('cmb', '/readings?limit=1');
    expect(own.body.count).toBe(await sqlCount('WHERE d.id = $1', [ids.district('CMB')]));
    const widened = await get('cmb', `/readings?province-id=${ids.province('WP')}&limit=1`);
    expect(widened.body.count).toBe(own.body.count);
    const foreign = await get('cmb', `/readings?district-id=${ids.district('KDY')}`);
    expect(foreign.body).toMatchObject({ data: [], count: 0, next: null, previous: null });
  });

  it('orders cross-installation ties by reading id in the sort direction', async () => {
    const q = `/readings?district-id=${ids.district('CMB')}&from=2026-09-30T06:00:00Z&to=2026-09-30T06:15:00Z&limit=100`;
    const asc = await get('national', `${q}&sort=timestamp`);
    const ids_ = asc.body.data.map((r: R) => r.id);
    expect(asc.body.count).toBeGreaterThan(1);
    expect(ids_).toEqual([...ids_].sort());
    const desc = await get('national', `${q}&sort=-timestamp`);
    expect(desc.body.data.map((r: R) => r.id)).toEqual([...ids_].reverse());
  });

  it('400 for contradictory geography', async () => {
    const res = await get(
      'national',
      `/readings?province-id=${ids.province('NP')}&district-id=${ids.district('CMB')}`,
    );
    expect([res.status, res.body.error[0].field]).toEqual([400, 'district-id']);
  });

  it('devices cannot read history (403)', async () => {
    const res = await request(t.app)
      .get('/solar/v1.0/readings')
      .set('Authorization', `Bearer ${await t.device(SITE)}`);
    expect(res.status).toBe(403);
  });

  it('a new matching reading changes the collection ETag', async () => {
    const q = `/installations/${ids.installation('MTR-000152')}/readings?limit=1`;
    const before = await get('national', q);
    const device = await t.device('MTR-000152');
    const posted = await request(t.app)
      .post(`/solar/v1.0/installations/${ids.installation('MTR-000152')}/readings`)
      .set('Authorization', `Bearer ${device}`)
      .send({
        timestamp: new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString(),
        power_kw: 1,
        cumulative_energy_kwh: 50_000,
        voltage_v: 230,
      });
    expect(posted.status).toBe(201);
    const after = await get('national', q).set('If-None-Match', before.headers.etag!);
    expect(after.status).toBe(200);
    expect(after.body.count).toBe(before.body.count + 1);
  });
});
