import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Vendored copies must match the installed swagger-ui-dist; run `npm run build` after upgrading.
const require = createRequire(import.meta.url);
const source = dirname(require.resolve('swagger-ui-dist/package.json'));
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

describe('vendored Swagger UI assets', () => {
  it.each(['swagger-ui-bundle.js', 'swagger-ui.css', 'favicon-32x32.png', 'LICENSE'])(
    '%s matches the installed swagger-ui-dist',
    (file) => {
      expect(sha(join('public/swagger-ui/vendor', file))).toBe(sha(join(source, file)));
    },
  );
});
