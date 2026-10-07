import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { buildTestApp, ids, type TestApp } from './app.js';

let t: TestApp;
let service: string;
let national: string;
const created: string[] = [];

beforeAll(async () => {
  t = await buildTestApp();
  service = await t.token('service', 'provisioning-service', 'installation-manage');
  national = await t.reader('national');
});
afterAll(async () => {
  // Remove anything a failed assertion left behind so other suites keep their seeded counts.
  const owner = new pg.Client({ connectionString: inject('databaseUrl') });
  await owner.connect();
  await owner.query('DELETE FROM solar_installations WHERE id = ANY($1::uuid[])', [created]);
  await owner.end();
  await t.close();
});

const api = (path: string) => `/solar/v1.0${path}`;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const newSite = (over: Record<string, unknown> = {}) => ({
  meter_id: `TEST-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
  label: 'Temporary CRUD demo site (synthetic)',
  capacity_kw: 4.5,
  commissioned_on: '2026-09-01',
  active: true,
  ...over,
});
const createSite = async (body = newSite(), substation = ids.substation('GSS-KDY-01')) => {
  const res = await request(t.app)
    .post(api(`/grid-substations/${substation}/installations`))
    .set(auth(service))
    .send(body);
  if (res.status === 201) created.push(res.body.id);
  return res;
};
const full = (inst: Record<string, unknown>) => ({
  substation_id: inst.substation_id,
  meter_id: inst.meter_id,
  label: inst.label,
  capacity_kw: inst.capacity_kw,
  commissioned_on: inst.commissioned_on,
  active: inst.active,
});

describe('T08 create (POST to the substation-scoped collection)', () => {
  it('201 with Location, ETag, Last-Modified; visible to the right jurisdiction only', async () => {
    const body = newSite();
    const res = await createSite(body);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ ...body, substation_id: ids.substation('GSS-KDY-01') });
    expect(res.headers.location).toBe(`/solar/v1.0/installations/${res.body.id}`);
    expect(res.headers['content-location']).toBe(res.headers.location);
    expect(res.headers.etag).toBeTruthy();
    expect(res.headers['last-modified']).toBeTruthy();
    const kandy = await request(t.app)
      .get(res.headers.location!)
      .set(auth(await t.reader('kdy')));
    expect(kandy.status).toBe(200);
    expect(kandy.headers.etag).toBe(res.headers.etag);
    expect(
      (
        await request(t.app)
          .get(res.headers.location!)
          .set(auth(await t.reader('cmb')))
      ).status,
    ).toBe(404);
  });

  it('409 duplicate meter, 404 unknown substation, 400 for invalid or over-specified bodies', async () => {
    const first = await createSite();
    const dup = await createSite(newSite({ meter_id: first.body.meter_id }));
    expect([dup.status, dup.body.code]).toEqual([409, 1062]);
    expect((await createSite(newSite(), ids.substation('GSS-NOPE-01'))).status).toBe(404);
    const withParent = await createSite(newSite({ substation_id: ids.substation('GSS-KDY-01') }));
    expect([withParent.status, withParent.body.code]).toEqual([400, 1001]);
    const withId = await createSite(newSite({ id: ids.installation('X') }));
    expect(withId.status).toBe(400);
    const bad = await createSite(newSite({ capacity_kw: 0, commissioned_on: '2026-02-30' }));
    expect(bad.body.error.map((e: { field: string }) => e.field).sort()).toEqual([
      'capacity_kw',
      'commissioned_on',
    ]);
  });

  it('only the provisioning service may create (analysts and devices get 403)', async () => {
    for (const token of [national, await t.device('MTR-000001')]) {
      const res = await request(t.app)
        .post(api(`/grid-substations/${ids.substation('GSS-KDY-01')}/installations`))
        .set(auth(token))
        .send(newSite());
      expect([res.status, res.body.code]).toEqual([403, 1020]);
    }
  });
});

describe('T08 replace (PUT) with optimistic concurrency', () => {
  it('requires If-Match (403), rejects stale validators (412) and replaces with a current one', async () => {
    const site = await createSite();
    const uri = site.headers.location!;
    const body = { ...full(site.body), label: 'Renamed demo site (synthetic)' };
    const missing = await request(t.app).put(uri).set(auth(service)).send(body);
    expect([missing.status, missing.body.code]).toEqual([403, 1021]);
    const stale = await request(t.app)
      .put(uri)
      .set(auth(service))
      .set('If-Match', '"stale"')
      .send(body);
    expect([stale.status, stale.body.code]).toEqual([412, 1070]);
    const weak = await request(t.app)
      .put(uri)
      .set(auth(service))
      .set('If-Match', `W/${site.headers.etag}`)
      .send(body);
    expect(weak.status).toBe(412);
    const ok = await request(t.app)
      .put(uri)
      .set(auth(service))
      .set('If-Match', site.headers.etag!)
      .send(body);
    expect(ok.status).toBe(200);
    expect(ok.body.label).toBe('Renamed demo site (synthetic)');
    expect(ok.headers.etag).not.toBe(site.headers.etag);
    const read = await request(t.app).get(uri).set(auth(national));
    expect(read.body).toEqual(ok.body);
    expect(read.headers.etag).toBe(ok.headers.etag);
  });

  it('is a complete replacement: a partial body is 400, not a partial update', async () => {
    const site = await createSite();
    const { label: _l, ...partial } = full(site.body);
    const res = await request(t.app)
      .put(site.headers.location!)
      .set(auth(service))
      .set('If-Match', site.headers.etag!)
      .send(partial);
    expect([res.status, res.body.error[0].field]).toEqual([400, 'label']);
  });

  it('a no-op PUT keeps the representation and its validator', async () => {
    const site = await createSite();
    const res = await request(t.app)
      .put(site.headers.location!)
      .set(auth(service))
      .set('If-Match', site.headers.etag!)
      .send(full(site.body));
    expect(res.status).toBe(200);
    expect(res.headers.etag).toBe(site.headers.etag);
    expect(res.body.updated_at).toBe(site.body.updated_at);
  });

  it('two concurrent writers with the same ETag: exactly one wins', async () => {
    const site = await createSite();
    const put = (label: string) =>
      request(t.app)
        .put(site.headers.location!)
        .set(auth(service))
        .set('If-Match', site.headers.etag!)
        .send({ ...full(site.body), label });
    const results = await Promise.all([put('Writer A'), put('Writer B')]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 412]);
  });

  it('404 for an unknown installation (PUT never creates)', async () => {
    const res = await request(t.app)
      .put(api(`/installations/${ids.installation('NEVER-EXISTED')}`))
      .set(auth(service))
      .set('If-Match', '*')
      .send({ substation_id: ids.substation('GSS-KDY-01'), ...newSite() });
    expect(res.status).toBe(404);
  });

  it('refuses to re-meter or re-parent an installation that has history (409) and changes nothing', async () => {
    const uri = api(`/installations/${ids.installation('MTR-000001')}`);
    const current = await request(t.app).get(uri).set(auth(service));
    expect(current.status).toBe(200);
    for (const change of [
      { meter_id: 'MTR-999999' },
      { substation_id: ids.substation('GSS-KDY-01') },
    ]) {
      const res = await request(t.app)
        .put(uri)
        .set(auth(service))
        .set('If-Match', current.headers.etag!)
        .send({ ...full(current.body), ...change });
      expect([res.status, res.body.code]).toEqual([409, 1063]);
    }
    expect((await request(t.app).get(uri).set(auth(service))).headers.etag).toBe(
      current.headers.etag,
    );
  });
});

describe('T08 delete', () => {
  it('deletes an installation without history; later GET and DELETE are 404 (same server state)', async () => {
    const site = await createSite();
    const uri = site.headers.location!;
    expect((await request(t.app).delete(uri).set(auth(service))).status).toBe(403);
    expect(
      (await request(t.app).delete(uri).set(auth(service)).set('If-Match', '"stale"')).status,
    ).toBe(412);
    const res = await request(t.app)
      .delete(uri)
      .set(auth(service))
      .set('If-Match', site.headers.etag!);
    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    expect((await request(t.app).get(uri).set(auth(national))).status).toBe(404);
    expect((await request(t.app).delete(uri).set(auth(service)).set('If-Match', '*')).status).toBe(
      404,
    );
  });

  it('never deletes an installation that has readings (409)', async () => {
    const uri = api(`/installations/${ids.installation('MTR-000001')}`);
    const current = await request(t.app).get(uri).set(auth(service));
    const res = await request(t.app)
      .delete(uri)
      .set(auth(service))
      .set('If-Match', current.headers.etag!);
    expect([res.status, res.body.code]).toEqual([409, 1061]);
  });

  it('analysts and devices cannot update or delete metadata', async () => {
    const uri = api(`/installations/${ids.installation('MTR-000001')}`);
    for (const token of [national, await t.device('MTR-000001')]) {
      expect((await request(t.app).delete(uri).set(auth(token)).set('If-Match', '*')).status).toBe(
        403,
      );
      expect(
        (await request(t.app).put(uri).set(auth(token)).set('If-Match', '*').send({})).status,
      ).toBe(403);
    }
  });
});

describe('T08 provisioning service boundaries', () => {
  it('has no access to analytics, hierarchy browsing or ingestion', async () => {
    for (const path of [
      '/provinces',
      '/installations',
      '/readings',
      `/installations/${ids.installation('MTR-000001')}/overview`,
    ]) {
      expect((await request(t.app).get(api(path)).set(auth(service))).status, path).toBe(403);
    }
    const ingest = await request(t.app)
      .post(api(`/installations/${ids.installation('MTR-000001')}/readings`))
      .set(auth(service))
      .send({
        timestamp: new Date().toISOString(),
        power_kw: 1,
        cumulative_energy_kwh: 1,
        voltage_v: 230,
      });
    expect(ingest.status).toBe(403);
  });
});
