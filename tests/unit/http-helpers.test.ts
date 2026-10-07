import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ApiError, errors } from '../../src/http/errors.js';
import { errorHandler, jsonBody, requestId } from '../../src/http/middleware.js';
import { acceptsJson } from '../../src/http/negotiate.js';
import { envelope } from '../../src/http/pagination.js';
import { etagFor, ifNoneMatchMatches, sendRepresentation } from '../../src/http/respond.js';

describe('acceptsJson (content negotiation)', () => {
  it.each([
    [undefined, true],
    ['', true],
    ['application/json', true],
    ['*/*', true],
    ['application/*', true],
    ['application/xml, application/json;q=0.5', true],
    ['application/json;q=0.9, application/xml;q=0.6, text/plain;q=0.1', true],
    ['text/html', false],
    ['application/xml', false],
    ['application/json;q=0', false],
    ['application/json;q=0, */*', false],
    ['*/*;q=0', false],
    ['application/*;q=0, application/json', true],
  ])('Accept %j -> %s', (header, expected) => {
    expect(acceptsJson(header)).toBe(expected);
  });
});

describe('ETag comparison', () => {
  const tag = etagFor('{"a":1}');
  it('produces a strong quoted validator that changes with content', () => {
    expect(tag).toMatch(/^"[A-Za-z0-9_-]+"$/);
    expect(etagFor('{"a":2}')).not.toBe(tag);
  });
  it('matches lists, wildcards and weak forms (weak comparison for GET)', () => {
    expect(ifNoneMatchMatches(tag, tag)).toBe(true);
    expect(ifNoneMatchMatches(`"x", ${tag}`, tag)).toBe(true);
    expect(ifNoneMatchMatches(`W/${tag}`, tag)).toBe(true);
    expect(ifNoneMatchMatches('*', tag)).toBe(true);
    expect(ifNoneMatchMatches('"other"', tag)).toBe(false);
  });
});

describe('sendRepresentation (conditional GET)', () => {
  const lastModified = new Date('2026-10-01T10:00:00.750Z');
  const app = express();
  app.use(requestId);
  app.get('/thing', (req, res) => sendRepresentation(req, res, { id: 1 }, { lastModified }));
  app.get('/plain', (req, res) => sendRepresentation(req, res, { id: 2 }));

  it('returns 200 with ETag, Last-Modified and private caching headers', async () => {
    const res = await request(app).get('/thing');
    expect(res.status).toBe(200);
    expect(res.headers.etag).toBe(etagFor('{"id":1}'));
    expect(res.headers['last-modified']).toBe('Thu, 01 Oct 2026 10:00:00 GMT');
    expect(res.headers['cache-control']).toBe('private, no-cache');
    expect(res.headers.vary).toBe('Authorization, Accept');
  });

  it('returns 304 with an empty body when If-None-Match matches', async () => {
    const first = await request(app).get('/thing');
    const res = await request(app).get('/thing').set('If-None-Match', first.headers.etag!);
    expect(res.status).toBe(304);
    expect(res.text).toBe('');
    expect(res.headers.etag).toBe(first.headers.etag);
  });

  it('honours If-Modified-Since at second resolution', async () => {
    const same = await request(app).get('/thing').set('If-Modified-Since', 'Thu, 01 Oct 2026 10:00:00 GMT');
    expect(same.status).toBe(304);
    const older = await request(app).get('/thing').set('If-Modified-Since', 'Thu, 01 Oct 2026 09:59:59 GMT');
    expect(older.status).toBe(200);
  });

  it('gives If-None-Match precedence over If-Modified-Since', async () => {
    const res = await request(app)
      .get('/thing')
      .set('If-None-Match', '"stale"')
      .set('If-Modified-Since', 'Thu, 01 Oct 2026 10:00:00 GMT');
    expect(res.status).toBe(200);
  });

  it('ignores If-Modified-Since when the resource has no reliable Last-Modified', async () => {
    const res = await request(app).get('/plain').set('If-Modified-Since', 'Thu, 01 Oct 2099 10:00:00 GMT');
    expect(res.status).toBe(200);
    expect(res.headers['last-modified']).toBeUndefined();
  });
});

describe('envelope (pagination links)', () => {
  const req = { baseUrl: '/solar/v1.0', path: '/readings' } as express.Request;
  const params = { from: '2026-10-01T00:00:00Z', sort: '-timestamp' };

  it('links first page forward only', () => {
    const e = envelope(req, [1], 120, { limit: 50, offset: 0 }, params);
    expect(e.previous).toBeNull();
    expect(e.next).toBe('/solar/v1.0/readings?from=2026-10-01T00%3A00%3A00Z&sort=-timestamp&limit=50&offset=50');
  });

  it('links a middle page both ways and the last page backward only', () => {
    const mid = envelope(req, [1], 120, { limit: 50, offset: 50 }, params);
    expect(mid.next).toContain('offset=100');
    expect(mid.previous).toContain('offset=0');
    const last = envelope(req, [1], 120, { limit: 50, offset: 100 }, params);
    expect(last.next).toBeNull();
    expect(last.previous).toContain('offset=50');
  });

  it('points previous at the last chunk when offset is beyond the end', () => {
    const e = envelope(req, [], 120, { limit: 50, offset: 500 }, params);
    expect(e).toMatchObject({ count: 120, next: null });
    expect(e.previous).toContain('offset=100');
  });

  it('has null links for an empty collection at offset 0', () => {
    expect(envelope(req, [], 0, { limit: 50, offset: 0 })).toMatchObject({ next: null, previous: null, count: 0 });
  });
});

describe('error handler', () => {
  const app = express();
  app.use(requestId);
  app.post('/body', ...jsonBody, (req, res) => {
    res.json(req.body);
  });
  app.get('/boom', () => {
    throw new Error('secret SQL detail');
  });
  app.get('/denied', () => {
    throw errors.authenticationRequired();
  });
  app.use(errorHandler);

  it('serialises ApiError with the common body and headers', async () => {
    const res = await request(app).get('/denied');
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/^Bearer/);
    expect(res.body).toEqual({
      code: 1010,
      message: 'A bearer token is required',
      description: 'Unauthorized',
      request_id: res.headers['x-request-id'],
    });
  });

  it('hides internal error details', async () => {
    const res = await request(app).get('/boom');
    expect(res.status).toBe(500);
    expect(res.body.code).toBe(1000);
    expect(JSON.stringify(res.body)).not.toContain('secret SQL');
  });

  it('maps malformed JSON to 400, wrong media type to 415 and oversize body to 413', async () => {
    const bad = await request(app).post('/body').set('Content-Type', 'application/json').send('{"a":');
    expect([bad.status, bad.body.code]).toEqual([400, 1002]);
    const text = await request(app).post('/body').set('Content-Type', 'text/plain').send('hello');
    expect([text.status, text.body.code]).toEqual([415, 1090]);
    const big = await request(app)
      .post('/body')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ x: 'a'.repeat(20_000) }));
    expect([big.status, big.body.code]).toEqual([413, 1080]);
  });

  it('keeps ApiError item lists', () => {
    const e = new ApiError(400, 1001, 'bad', [{ code: 1001, message: 'm', field: 'f' }]);
    expect(e.toBody('r')).toMatchObject({ error: [{ field: 'f' }], description: 'Bad request' });
  });
});
