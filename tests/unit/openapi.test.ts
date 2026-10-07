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
    const params = (loadSpec().components as { parameters: Record<string, { name: string; in: string }> }).parameters;
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
      expect(Object.keys(op.responses), `${method} ${path}`).toEqual(expect.arrayContaining(['401', '406']));
    }
  });

  it('documents 304 for every GET and 201 for every POST', () => {
    for (const { path, method, op } of operations()) {
      if (method === 'get') expect(Object.keys(op.responses), path).toContain('304');
      if (method === 'post') expect(Object.keys(op.responses), path).toContain('201');
    }
  });
});
