import SwaggerParser from '@apidevtools/swagger-parser';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import type { Router } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { specPath } from '../../src/openapi/spec.js';
import { buildTestApp, ids, type TestApp } from './app.js';

type Schema = Record<string, unknown>;
type Operation = {
  responses: Record<string, { content?: { 'application/json'?: { schema: Schema } } }>;
};
type Spec = { paths: Record<string, Record<string, Operation>> };

const addFormats = addFormatsModule as unknown as (ajv: Ajv2020) => void;
let spec: Spec;
let ajv: Ajv2020;
let t: TestApp;
let national: string;

beforeAll(async () => {
  spec = (await SwaggerParser.dereference(specPath)) as unknown as Spec;
  ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  t = await buildTestApp();
  national = await t.reader('national');
});
afterAll(async () => {
  await t.close();
});

function schemaFor(path: string, method: string, status: number): Schema | undefined {
  return spec.paths[path]?.[method]?.responses[String(status)]?.content?.['application/json']
    ?.schema;
}

function expectConforms(path: string, method: string, status: number, body: unknown) {
  const schema = schemaFor(path, method, status);
  expect(
    schema,
    `${method.toUpperCase()} ${path} has no documented ${status} JSON schema`,
  ).toBeDefined();
  const validate = ajv.compile(schema!);
  const ok = validate(body);
  expect(ok, `${method.toUpperCase()} ${path} ${status}: ${JSON.stringify(validate.errors)}`).toBe(
    true,
  );
}

/** Every route the Express app actually serves under the API base path, as "METHOD /template". */
function runtimeOperations(): Set<string> {
  const ops = new Set<string>();
  const app = t.app as unknown as { router: Router };
  type Layer = {
    route?: { path: string; methods: Record<string, boolean> };
    handle: { stack?: unknown[] };
    match(path: string): boolean;
  };
  const walk = (stack: unknown[], inApi: boolean) => {
    for (const layer of stack as Layer[]) {
      if (layer.route) {
        if (!inApi) continue;
        const template = layer.route.path.replace(
          /:([A-Za-z]+)/g,
          (_m, p: string) => `{${p.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}}`,
        );
        for (const [m, on] of Object.entries(layer.route.methods)) {
          if (on && m !== '_all') ops.add(`${m.toUpperCase()} ${template}`);
        }
      } else if (layer.handle?.stack) {
        // The API router is the one mounted at the base path (it does not match other paths).
        const isApiMount = layer.match('/solar/v1.0/x') && !layer.match('/elsewhere');
        walk(layer.handle.stack, inApi || isApiMount);
      }
    }
  };
  walk(app.router.stack, false);
  return ops;
}

describe('T14 route inventory parity', () => {
  it('every runtime API route is documented and every documented operation is served', () => {
    const documented = new Set(
      Object.entries(spec.paths).flatMap(([path, item]) =>
        Object.keys(item)
          .filter((m) => ['get', 'post', 'put', 'delete', 'patch'].includes(m))
          .map((m) => `${m.toUpperCase()} ${path}`),
      ),
    );
    const runtime = runtimeOperations();
    expect(
      [...runtime].filter((o) => !documented.has(o)).sort(),
      'undocumented runtime routes',
    ).toEqual([]);
    expect(
      [...documented].filter((o) => !runtime.has(o)).sort(),
      'documented but not served',
    ).toEqual([]);
    expect(runtime.size).toBeGreaterThanOrEqual(20);
  });
});

describe('T14 responses conform to the OpenAPI schemas', () => {
  const site = ids.installation('MTR-000001');
  const cases: Array<[string, string]> = [
    ['/provinces', '/provinces'],
    ['/provinces/{province-id}', `/provinces/${ids.province('WP')}`],
    ['/provinces/{province-id}/districts', `/provinces/${ids.province('WP')}/districts`],
    ['/districts', '/districts'],
    ['/districts/{district-id}', `/districts/${ids.district('CMB')}`],
    [
      '/districts/{district-id}/generation-summary',
      `/districts/${ids.district('CMB')}/generation-summary?date=2026-09-30&as-of=2026-10-01T00:00:00Z`,
    ],
    [
      '/districts/{district-id}/grid-substations',
      `/districts/${ids.district('CMB')}/grid-substations`,
    ],
    ['/grid-substations', '/grid-substations'],
    ['/grid-substations/{substation-id}', `/grid-substations/${ids.substation('GSS-CMB-01')}`],
    [
      '/grid-substations/{substation-id}/installations',
      `/grid-substations/${ids.substation('GSS-CMB-01')}/installations`,
    ],
    ['/installations', '/installations'],
    ['/installations/{installation-id}', `/installations/${site}`],
    ['/installations/{installation-id}/overview', `/installations/${site}/overview`],
    [
      '/installations/{installation-id}/overview',
      `/installations/${ids.installation('MTR-000201')}/overview`,
    ],
    [
      '/installations/{installation-id}/last-known-reading',
      `/installations/${site}/last-known-reading`,
    ],
    ['/installations/{installation-id}/readings', `/installations/${site}/readings?limit=3`],
    ['/readings', '/readings?limit=3&sort=timestamp'],
  ];

  it.each(cases)('GET %s (200)', async (template, path) => {
    const res = await request(t.app)
      .get(`/solar/v1.0${path}`)
      .set('Authorization', `Bearer ${national}`);
    expect(res.status).toBe(200);
    expectConforms(template, 'get', 200, res.body);
  });

  it('reading atom (200) and device ingestion (201)', async () => {
    const device = await t.device('MTR-000154');
    const created = await request(t.app)
      .post(`/solar/v1.0/installations/${ids.installation('MTR-000154')}/readings`)
      .set('Authorization', `Bearer ${device}`)
      .send({
        timestamp: new Date(Math.floor(Date.now() / 60_000) * 60_000).toISOString(),
        power_kw: 1,
        cumulative_energy_kwh: 1,
        voltage_v: 230,
      });
    expectConforms('/installations/{installation-id}/readings', 'post', 201, created.body);
    const read = await request(t.app)
      .get(created.headers.location!)
      .set('Authorization', `Bearer ${national}`);
    expectConforms('/installations/{installation-id}/readings/{reading-id}', 'get', 200, read.body);
  });

  it('error bodies (400, 401, 403, 404, 406, 409) use the common Error schema', async () => {
    const path = '/installations/{installation-id}/readings';
    const url = `/solar/v1.0/installations/${site}/readings`;
    expectConforms(path, 'get', 401, (await request(t.app).get(url)).body);
    expectConforms(
      path,
      'get',
      400,
      (await request(t.app).get(`${url}?limit=0`).set('Authorization', `Bearer ${national}`)).body,
    );
    expectConforms(
      path,
      'get',
      403,
      (
        await request(t.app)
          .get(url)
          .set('Authorization', `Bearer ${await t.device('MTR-000001')}`)
      ).body,
    );
    expectConforms(
      path,
      'get',
      404,
      (
        await request(t.app)
          .get(`/solar/v1.0/installations/${ids.installation('NOPE')}/readings`)
          .set('Authorization', `Bearer ${national}`)
      ).body,
    );
    expectConforms(
      path,
      'get',
      406,
      (
        await request(t.app)
          .get(url)
          .set('Authorization', `Bearer ${national}`)
          .set('Accept', 'text/csv')
      ).body,
    );
    const seeded = await request(t.app)
      .get(`${url}?limit=1`)
      .set('Authorization', `Bearer ${national}`);
    const dup = await request(t.app)
      .post(url)
      .set('Authorization', `Bearer ${await t.device('MTR-000001')}`)
      .send({
        timestamp: seeded.body.data[0].timestamp,
        power_kw: 0,
        cumulative_energy_kwh: 1,
        voltage_v: 230,
      });
    expect(dup.status).toBe(409);
    expectConforms(path, 'post', 409, dup.body);
  });
});
