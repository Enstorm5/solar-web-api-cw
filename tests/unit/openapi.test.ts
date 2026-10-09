import SwaggerParser from '@apidevtools/swagger-parser';
import { describe, expect, it } from 'vitest';
import { loadSpec, specPath } from '../../src/openapi/spec.js';

type Operation = { operationId?: string; responses: Record<string, unknown>; security?: unknown[] };
type PathItem = Record<string, Operation>;

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

function operations(): Array<{ path: string; method: string; op: Operation }> {
  const paths = loadSpec().paths as Record<string, PathItem>;
  return Object.entries(paths).flatMap(([path, item]) =>
    Object.entries(item)
      .filter(([method]) => METHODS.includes(method))
      .map(([method, op]) => ({ path, method, op })),
  );
}

describe('OpenAPI contract', () => {
  it('is a valid OpenAPI 3.1 document', async () => {
    await expect(SwaggerParser.validate(specPath)).resolves.toBeDefined();
  });

  it('uses lowercase hyphenated path segments and parameter names', () => {
    for (const { path } of operations()) {
      for (const segment of path.split('/').filter(Boolean)) {
        expect(segment, path).toMatch(/^([a-z0-9]+(-[a-z0-9]+)*|\{[a-z0-9]+(-[a-z0-9]+)*\})$/);
      }
    }
    const params = (
      loadSpec().components as { parameters: Record<string, { name: string; in: string }> }
    ).parameters;
    for (const p of Object.values(params).filter((p) => p.in !== 'header')) {
      expect(p.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it('gives every operation a unique operationId and documents 401 and 406', () => {
    const ids = new Set<string>();
    for (const { path, method, op } of operations()) {
      expect(op.operationId, `${method} ${path}`).toBeTruthy();
      expect(ids.has(op.operationId!)).toBe(false);
      ids.add(op.operationId!);
      expect(Object.keys(op.responses), `${method} ${path}`).toEqual(
        expect.arrayContaining(['401', '406']),
      );
    }
  });

  it('documents 304 for every GET and 201 for every POST', () => {
    for (const { path, method, op } of operations()) {
      if (method === 'get') expect(Object.keys(op.responses), path).toContain('304');
      if (method === 'post') expect(Object.keys(op.responses), path).toContain('201');
    }
  });
});

describe('OpenAPI error examples', () => {
  // Documented example codes must exist in the runtime catalogue and belong to the right status.
  const allowed: Record<string, number[]> = {
    BadRequest: [1001, 1002, 1003, 1004],
    Unauthorized: [1010, 1011],
    Forbidden: [1020, 1021],
    NotFound: [1030, 1031],
    NotAcceptable: [1050],
    Conflict: [1060, 1061, 1062, 1063],
    PreconditionFailed: [1070],
    PayloadTooLarge: [1080],
    UnsupportedMediaType: [1090],
  };

  it('gives every error response its own examples with valid, matching codes', async () => {
    const { Ajv2020 } = await import('ajv/dist/2020.js');
    const { ErrorCode } = await import('../../src/http/errors.js');
    const spec = (await SwaggerParser.dereference(specPath)) as unknown as {
      components: {
        responses: Record<
          string,
          {
            content?: Record<
              string,
              { schema: object; examples?: Record<string, { value: { code: number } }> }
            >;
          }
        >;
      };
    };
    const known = new Set<number>(Object.values(ErrorCode));
    for (const [name, codes] of Object.entries(allowed)) {
      const media = spec.components.responses[name]?.content?.['application/json'];
      const examples = Object.values(media?.examples ?? {});
      expect(examples.length, name).toBeGreaterThan(0);
      const validate = new Ajv2020({ strict: false }).compile(media!.schema);
      for (const { value } of examples) {
        expect(validate(value), `${name}: ${JSON.stringify(validate.errors)}`).toBe(true);
        expect(known.has(value.code), `${name}: unknown code ${value.code}`).toBe(true);
        expect(codes, `${name}: code ${value.code}`).toContain(value.code);
      }
    }
  });
});
