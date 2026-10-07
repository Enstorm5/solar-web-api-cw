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
//   In PowerShell call npm.cmd instead of npm, otherwise PowerShell swallows the `--`.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
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
} else {
  console.error('Commands: keygen | issue | inspect | tamper');
  process.exit(1);
}
