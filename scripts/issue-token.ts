// Offline token tooling. The private key never leaves .secrets/ (git-ignored) and is never
// deployed; the API only receives the public key.
//
//   npm run token -- keygen
//   npm run token -- issue --principal user --sub analyst-national --scope analyst-read-national [--ttl 30d]
//   npm run token -- issue --principal device --sub <installation-uuid> --scope installation-write
//   npm run token -- issue --principal service --sub provisioning-service --scope installation-manage
//   npm run token -- inspect <token>   (decode header/claims and verify locally with the public key)
//   npm run token -- tamper <token> --sub analyst-national --scope analyst-read-national
//     (security demo: rewrites claims but keeps the original signature; the API must reject it)
//   npm run token -- subjects [n]      (valid --sub values from the database, with their scopes)
//   npm run token -- help
//   In PowerShell call npm.cmd instead of npm, otherwise PowerShell swallows the `--`.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import pg from 'pg';
import {
  calculateJwkThumbprint,
  decodeJwt,
  decodeProtectedHeader,
  exportJWK,
  exportPKCS8,
  exportSPKI,
  generateKeyPair,
} from 'jose';
import {
  ALGORITHM,
  importPrivateKey,
  importPublicKey,
  signAccessToken,
  verifyAccessToken,
} from '../src/auth/tokens.js';

const SECRETS = '.secrets';
const PRIVATE = `${SECRETS}/jwt-private.pem`;
const PUBLIC = `${SECRETS}/jwt-public.pem`;

const [command, ...rest] = process.argv.slice(2);

if (command === 'keygen') {
  if (existsSync(PRIVATE) && !rest.includes('--force')) {
    console.error(
      `${PRIVATE} already exists; pass --force to replace it (invalidates all issued tokens).`,
    );
    process.exit(1);
  }
  const { publicKey, privateKey } = await generateKeyPair(ALGORITHM, { extractable: true });
  mkdirSync(SECRETS, { recursive: true });
  writeFileSync(PRIVATE, await exportPKCS8(privateKey), { mode: 0o600 });
  const spki = await exportSPKI(publicKey);
  writeFileSync(PUBLIC, spki);
  console.log(`Wrote ${PRIVATE} (keep secret) and ${PUBLIC}.`);
  console.log(`JWT_PUBLIC_KEY (base64 form for env vars): ${Buffer.from(spki).toString('base64')}`);
} else if (command === 'issue') {
  const { values } = parseArgs({
    args: rest,
    options: {
      principal: { type: 'string' },
      sub: { type: 'string' },
      scope: { type: 'string' },
      ttl: { type: 'string', default: '30d' },
    },
  });
  if (
    !['user', 'device', 'service'].includes(values.principal ?? '') ||
    !values.sub ||
    !values.scope
  ) {
    console.error(
      'Usage: issue --principal user|device|service --sub <subject> --scope "<scopes>" [--ttl 30d]',
    );
    process.exit(1);
  }
  const privateKey = await importPrivateKey(
    readFileSync(process.env.JWT_PRIVATE_KEY_FILE ?? PRIVATE, 'utf8'),
  );
  const token = await signAccessToken({
    privateKey,
    kid: await calculateJwkThumbprint(await exportJWK(privateKey)),
    issuer: process.env.JWT_ISSUER ?? 'https://auth.slsea.example/solar',
    audience: process.env.JWT_AUDIENCE ?? 'solar-api',
    subject: values.sub,
    principal: values.principal as 'user' | 'device' | 'service',
    scope: values.scope,
    expiresIn: values.ttl,
  });
  // Token goes to stdout only, so it can be redirected into a private file.
  process.stdout.write(`${token}\n`);
} else if (command === 'inspect') {
  // Decoding needs no key (a JWT is only base64url-encoded, not encrypted); trust comes from
  // the signature check below, which is exactly what the deployed API does on every request.
  const token = rest[0]?.trim();
  if (!token) {
    console.error('Usage: inspect <token>');
    process.exit(1);
  }
  const iso = (s?: number) => (s ? new Date(s * 1000).toISOString() : undefined);
  try {
    const claims = decodeJwt(token);
    console.log('Header :', JSON.stringify(decodeProtectedHeader(token)));
    console.log('Claims :', JSON.stringify(claims, null, 2));
    console.log(`Issued : ${iso(claims.iat)}   Expires: ${iso(claims.exp)}`);
  } catch {
    console.log('Decode : not a well-formed JWT');
  }
  try {
    await verifyAccessToken(token, {
      publicKey: await importPublicKey(readFileSync(PUBLIC, 'utf8')),
      issuer: process.env.JWT_ISSUER ?? 'https://auth.slsea.example/solar',
      audience: process.env.JWT_AUDIENCE ?? 'solar-api',
    });
    console.log('Verify : VALID (ES256 signature, issuer, audience and expiry all check out)');
  } catch (err) {
    console.log(`Verify : INVALID (${(err as Error).message})`);
    process.exitCode = 1;
  }
} else if (command === 'tamper') {
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    options: { sub: { type: 'string' }, scope: { type: 'string' } },
  });
  const parts = positionals[0]?.trim().split('.');
  if (parts?.length !== 3) {
    console.error('Usage: tamper <token> [--sub <subject>] [--scope "<scopes>"]');
    process.exit(1);
  }
  const claims = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));
  if (values.sub) claims.sub = values.sub;
  if (values.scope) claims.scope = values.scope;
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  // Same header and signature, edited payload: what an attacker without the private key can do.
  process.stdout.write(`${parts[0]}.${payload}.${parts[2]}\n`);
} else if (command === 'subjects') {
  // Lists the identities a token can name, read from the database the API uses (DATABASE_URL).
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('Set DATABASE_URL (loaded from .env when present).');
    process.exit(1);
  }
  const scopeFor = {
    national: 'analyst-read-national',
    provincial: 'analyst-read-province',
    district: 'analyst-read-district',
  };
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  try {
    const users = await db.query<{
      subject: string;
      role: keyof typeof scopeFor;
      area: string | null;
      active: boolean;
    }>(
      `SELECT u.subject, u.role, COALESCE(p.name, d.name) AS area, u.active
         FROM users u LEFT JOIN provinces p ON p.id = u.province_id LEFT JOIN districts d ON d.id = u.district_id
        ORDER BY u.role, u.subject`,
    );
    console.log('\nUsers  (--principal user --sub <subject> --scope <scope>)');
    console.table(
      users.rows.map((u) => ({
        sub: u.subject,
        scope: scopeFor[u.role],
        role: u.role,
        area: u.area ?? 'all of Sri Lanka',
        active: u.active,
      })),
    );
    const limit = Number(rest[0] ?? 10);
    const devices = await db.query<{
      id: string;
      meter_id: string;
      district: string;
      active: boolean;
    }>(
      `SELECT i.id, i.meter_id, d.name AS district, i.active
         FROM solar_installations i JOIN grid_substations s ON s.id = i.substation_id JOIN districts d ON d.id = s.district_id
        ORDER BY i.meter_id LIMIT $1`,
      [limit],
    );
    const total = (
      await db.query<{ n: number }>('SELECT count(*)::int AS n FROM solar_installations')
    ).rows[0]!.n;
    console.log(
      `\nDevices  (--principal device --sub <id> --scope installation-write)  first ${devices.rowCount} of ${total}; pass a number for more`,
    );
    console.table(
      devices.rows.map((d) => ({
        sub: d.id,
        meter_id: d.meter_id,
        district: d.district,
        active: d.active,
      })),
    );
    console.log(
      '\nService  (--principal service --sub provisioning-service --scope installation-manage)\n',
    );
  } finally {
    await db.end();
  }
} else {
  console.log(`Token tool. In PowerShell use npm.cmd (PowerShell swallows "--" for npm).

  npm.cmd run -s token -- help                 this text
  npm.cmd run -s token -- subjects [n]         users and device ids in the database, with their scopes
  npm.cmd run -s token -- issue --principal <p> --sub <subject> --scope <scope> [--ttl 1h|1d|60d]
  npm.cmd run -s token -- inspect <token>      decode and verify locally
  npm.cmd run -s token -- tamper <token> [--sub x] [--scope y]   forgery demo (API must answer 401)
  npm.cmd run -s token -- keygen               create the key pair (never --force without updating Vercel)

  --principal   --sub                                   --scope
  user          a users.subject (see "subjects")        must match the user's role:
                                                        analyst-read-national | analyst-read-province | analyst-read-district
  device        an installation id (see "subjects")     installation-write
  service       provisioning-service                    installation-manage
  --ttl         default 30d; e.g. 15m, 1h, 1d, 60d`);
  process.exitCode = command && command !== 'help' ? 1 : 0;
}
