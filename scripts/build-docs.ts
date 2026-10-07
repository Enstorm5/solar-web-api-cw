// `npm run build` (also run by Vercel): refreshes the vendored Swagger UI assets in
// public/swagger-ui/vendor from the installed swagger-ui-dist package. The copies are committed
// because Vercel's Express builder collects public/ from the repository before this build step
// runs, so files generated here would not be served. Run this after upgrading swagger-ui-dist and
// commit the result (tests/unit/swagger-assets.test.ts fails if the copies drift).
// The OpenAPI document itself is served live from openapi/openapi.yaml by GET /openapi.json.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

export const VENDOR_DIR = 'public/swagger-ui/vendor';
export const VENDOR_FILES = [
  'swagger-ui-bundle.js',
  'swagger-ui.css',
  'favicon-32x32.png',
  'LICENSE',
];

const require = createRequire(import.meta.url);
const swaggerDir = dirname(require.resolve('swagger-ui-dist/package.json'));
mkdirSync(VENDOR_DIR, { recursive: true });
for (const f of VENDOR_FILES) copyFileSync(join(swaggerDir, f), join(VENDOR_DIR, f));
console.log(`Refreshed ${VENDOR_DIR}/* from swagger-ui-dist`);
