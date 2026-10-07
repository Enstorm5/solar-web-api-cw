import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

export const specPath = fileURLToPath(new URL('../../openapi/openapi.yaml', import.meta.url));

export function loadSpec(): Record<string, unknown> {
  return parse(readFileSync(specPath, 'utf8')) as Record<string, unknown>;
}
