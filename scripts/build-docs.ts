// Build step (`npm run build`, also run by Vercel): writes the static documentation assets that
// Vercel serves from public/ (express.static is ignored on Vercel).
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { loadSpec } from '../src/openapi/spec.js';

const require = createRequire(import.meta.url);
const swaggerDir = dirname(require.resolve('swagger-ui-dist/package.json'));
const vendor = 'public/swagger-ui/vendor';
mkdirSync(vendor, { recursive: true });
for (const f of ['swagger-ui-bundle.js', 'swagger-ui.css', 'favicon-32x32.png', 'LICENSE']) {
  copyFileSync(join(swaggerDir, f), join(vendor, f));
}
writeFileSync('public/openapi.json', JSON.stringify(loadSpec(), null, 2));
console.log('Wrote public/openapi.json and public/swagger-ui/vendor/*');
