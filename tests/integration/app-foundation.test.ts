import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp, ids, type TestApp } from './app.js';

let t: TestApp;
beforeAll(async () => {
  t = await buildTestApp();
});
afterAll(async () => {
  await t.close();
});

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

describe('health', () => {
  it('reports liveness and database readiness', async () => {
    expect((await request(t.app).get('/health/live')).body).toEqual({ status: 'ok' });
    const ready = await request(t.app).get('/health/ready');
    expect(ready.status).toBe(200);
  });
});

describe('T09 authentication on the protected surface', () => {
  it('401 + WWW-Authenticate without a token', async () => {
    const res = await request(t.app).get('/solar/v1.0/provinces');
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/^Bearer realm="solar"/);
    expect(res.body.code).toBe(1010);
  });

  it('401 for a malformed Authorization header, a foreign-key token and an unknown subject', async () => {
    expect((await request(t.app).get('/solar/v1.0/provinces').set('Authorization', 'Basic abc')).status).toBe(401);
    const other = await buildTestApp();
    const foreign = await other.reader('national');
    await other.close();
    const res = await request(t.app).get('/solar/v1.0/provinces').set(auth(foreign));
    expect([res.status, res.body.code]).toEqual([401, 1011]);
    expect(res.headers['www-authenticate']).toContain('invalid_token');
    const ghost = await t.token('user', 'nobody', 'analyst-read-national');
    expect((await request(t.app).get('/solar/v1.0/provinces').set(auth(ghost))).status).toBe(401);
  });

  it('401 for unknown routes when unauthenticated, 404 once authenticated', async () => {
    expect((await request(t.app).get('/solar/v1.0/nope')).status).toBe(401);
    const res = await request(t.app).get('/solar/v1.0/nope').set(auth(await t.reader('national')));
    expect([res.status, res.body.code]).toEqual([404, 1031]);
  });

  it('403 when a device token reads business data', async () => {
    const res = await request(t.app).get('/solar/v1.0/provinces').set(auth(await t.device('MTR-000001')));
    expect([res.status, res.body.code]).toEqual([403, 1020]);
  });

  it('403 when the token scope does not match the user’s current role', async () => {
    const escalated = await t.token('user', 'analyst-cmb', 'analyst-read-national');
    expect((await request(t.app).get('/solar/v1.0/provinces').set(auth(escalated))).status).toBe(403);
  });
});

describe('T10 negotiation and method handling', () => {
  it('406 for Accept without JSON, but 401 takes precedence when unauthenticated', async () => {
    const token = await t.reader('national');
    const res = await request(t.app).get('/solar/v1.0/provinces').set(auth(token)).set('Accept', 'application/xml');
    expect([res.status, res.body.code]).toEqual([406, 1050]);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect((await request(t.app).get('/solar/v1.0/provinces').set('Accept', 'application/xml')).status).toBe(401);
    const mixed = await request(t.app).get('/solar/v1.0/provinces').set(auth(token)).set('Accept', 'application/xml, application/json;q=0.5');
    expect(mixed.status).toBe(200);
  });

  it('405 with Allow for unsupported methods', async () => {
    const res = await request(t.app).delete('/solar/v1.0/provinces').set(auth(await t.reader('national')));
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe('GET, HEAD');
  });

  it('400 for unknown or malformed query parameters and path ids', async () => {
    const token = await t.reader('national');
    const unknown = await request(t.app).get('/solar/v1.0/provinces?colour=red').set(auth(token));
    expect([unknown.status, unknown.body.code]).toEqual([400, 1003]);
    const badLimit = await request(t.app).get('/solar/v1.0/provinces?limit=0').set(auth(token));
    expect(badLimit.body.error[0]).toMatchObject({ field: 'limit' });
    const badId = await request(t.app).get('/solar/v1.0/provinces/not-a-uuid').set(auth(token));
    expect([badId.status, badId.body.code]).toEqual([400, 1004]);
  });
});

describe('provinces (vertical slice)', () => {
  it('national reader sees all 9 provinces with a pagination envelope', async () => {
    const res = await request(t.app).get('/solar/v1.0/provinces?limit=5').set(auth(await t.reader('national')));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ count: 9, limit: 5, offset: 0, previous: null });
    expect(res.body.data).toHaveLength(5);
    expect(res.body.next).toBe('/solar/v1.0/provinces?limit=5&offset=5');
    expect(res.headers.etag).toBeTruthy();
  });

  it('provincial and district readers see only their own province', async () => {
    for (const who of ['wp', 'cmb'] as const) {
      const res = await request(t.app).get('/solar/v1.0/provinces').set(auth(await t.reader(who)));
      expect(res.body.count).toBe(1);
      expect(res.body.data[0].code).toBe('WP');
    }
  });

  it('foreign province is 404, indistinguishable from nonexistent', async () => {
    const token = await t.reader('cmb');
    const foreign = await request(t.app).get(`/solar/v1.0/provinces/${ids.province('CP')}`).set(auth(token));
    const missing = await request(t.app).get(`/solar/v1.0/provinces/${ids.district('XXX')}`).set(auth(token));
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect({ ...foreign.body, request_id: '' }).toEqual({ ...missing.body, request_id: '' });
  });

  it('conditional GET returns 304 with empty body, and differs per jurisdiction', async () => {
    const token = await t.reader('wp');
    const first = await request(t.app).get(`/solar/v1.0/provinces/${ids.province('WP')}`).set(auth(token));
    expect(first.body).toMatchObject({ code: 'WP', name: 'Western' });
    const again = await request(t.app)
      .get(`/solar/v1.0/provinces/${ids.province('WP')}`)
      .set(auth(token))
      .set('If-None-Match', first.headers.etag!);
    expect(again.status).toBe(304);
    expect(again.text).toBe('');
    const national = await request(t.app).get('/solar/v1.0/provinces').set(auth(await t.reader('national')));
    const provincial = await request(t.app).get('/solar/v1.0/provinces').set(auth(token));
    expect(national.headers.etag).not.toBe(provincial.headers.etag);
  });
});
