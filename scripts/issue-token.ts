// Offline token tooling. The private key never leaves .secrets/ (git-ignored) and is never
// deployed; the API only receives the public key.
//
//   npm run token -- keygen
//   npm run token -- issue --principal user --sub analyst-national --scope analyst-read-national [--ttl 30d]
//   npm run token -- issue --principal device --sub <installation-uuid> --scope installation-write
//   npm run token -- issue --principal service --sub provisioning-service --scope installation-manage
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { calculateJwkThumbprint, exportJWK, exportPKCS8, exportSPKI, generateKeyPair } from 'jose';
import { ALGORITHM, importPrivateKey, signAccessToken } from '../src/auth/tokens.js';

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
} else {
  console.error('Commands: keygen | issue');
  process.exit(1);
}
