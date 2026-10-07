// `SMOKE_BASE_URL=https://... npm run smoke`: read-only checks against a deployment, using short-lived
// tokens signed with the local private key (.secrets/jwt-private.pem). Never mutates data.
import { readFileSync } from 'node:fs';
import { importPrivateKey, signAccessToken } from '../src/auth/tokens.js';
import { seedUuid } from '../src/seed/generate.js';

const base = (process.env.SMOKE_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const api = `${base}/solar/v1.0`;
const privateKey = await importPrivateKey(readFileSync(process.env.JWT_PRIVATE_KEY_FILE ?? '.secrets/jwt-private.pem', 'utf8'));
const token = (principal: 'user' | 'device', subject: string, scope: string) =>
  signAccessToken({
    privateKey,
    issuer: process.env.JWT_ISSUER ?? 'https://auth.slsea.example/solar',
    audience: process.env.JWT_AUDIENCE ?? 'solar-api',
    subject,
    principal,
    scope,
    expiresIn: '10m',
  });

const national = await token('user', 'analyst-national', 'analyst-read-national');
const cmb = await token('user', 'analyst-cmb', 'analyst-read-district');
const device = await token('device', seedUuid('installation:MTR-000001'), 'installation-write');

let failures = 0;
async function check(name: string, url: string, init: RequestInit, expect: (r: Response, body: string) => boolean) {
  const started = Date.now();
  const res = await fetch(url, init);
  const body = await res.text();
  const ok = expect(res, body);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  [${res.status}, ${Date.now() - started} ms]${ok ? '' : `  ${body.slice(0, 200)}`}`);
  return { res, body };
}
const bearer = (t: string, extra: Record<string, string> = {}) => ({ headers: { Authorization: `Bearer ${t}`, ...extra } });

await check('liveness', `${base}/health/live`, {}, (r) => r.status === 200);
await check('readiness (database)', `${base}/health/ready`, {}, (r) => r.status === 200);
await check('Swagger UI', `${base}/docs`, {}, (r) => r.status === 200 && (r.headers.get('content-type') ?? '').includes('text/html'));
await check('Swagger bundle asset', `${base}/swagger-ui/vendor/swagger-ui-bundle.js`, {}, (r) => r.status === 200);
await check('OpenAPI document', `${base}/openapi.json`, {}, (r, b) => r.status === 200 && JSON.parse(b).openapi === '3.1.0');
await check('401 without token', `${api}/provinces`, {}, (r) => r.status === 401 && (r.headers.get('www-authenticate') ?? '').startsWith('Bearer'));
const list = await check('national reader sees 9 provinces', `${api}/provinces`, bearer(national), (r, b) => r.status === 200 && JSON.parse(b).count === 9);
await check(
  '304 on matching If-None-Match (empty body)',
  `${api}/provinces`,
  bearer(national, { 'If-None-Match': list.res.headers.get('etag') ?? '' }),
  (r, b) => r.status === 304 && b === '',
);
await check('district reader scoped to own province', `${api}/provinces`, bearer(cmb), (r, b) => r.status === 200 && JSON.parse(b).count === 1);
await check('foreign province hidden (404)', `${api}/provinces/${seedUuid('province:CP')}`, bearer(cmb), (r) => r.status === 404);
await check('device cannot read (403)', `${api}/provinces`, bearer(device), (r) => r.status === 403);
await check('406 for non-JSON Accept', `${api}/provinces`, bearer(national, { Accept: 'application/xml' }), (r) => r.status === 406);

console.log(failures === 0 ? `All smoke checks passed against ${base}` : `${failures} smoke check(s) FAILED against ${base}`);
process.exitCode = failures === 0 ? 0 : 1;
