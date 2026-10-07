// `npm run db:runtime-role`: creates/rotates the least-privilege API role using the owner
// connection (MIGRATION_DATABASE_URL), then prints a redacted runtime URL. The new password is
// written only to .env as DATABASE_URL (pooled host) — copy it to Vercel from there.
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import pg from 'pg';
import { ensureRuntimeRole, RUNTIME_ROLE } from '../src/db/runtime-role.js';

const owner = process.env.MIGRATION_DATABASE_URL;
if (!owner) {
  console.error('Set MIGRATION_DATABASE_URL (owner, direct connection).');
  process.exit(1);
}
const password = randomBytes(24).toString('base64url');
const client = new pg.Client({ connectionString: owner });
await client.connect();
try {
  await ensureRuntimeRole(client, password);
} finally {
  await client.end();
}

const url = new URL(owner);
url.username = RUNTIME_ROLE;
url.password = password;
// Runtime traffic goes through Neon's pooler endpoint.
url.hostname = url.hostname.replace(/^(ep-[^.]+?)(-pooler)?\./, '$1-pooler.');
const runtimeUrl = url.toString();

const env = readFileSync('.env', 'utf8');
const updated = /^DATABASE_URL=.*$/m.test(env)
  ? env.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${runtimeUrl}`)
  : `DATABASE_URL=${runtimeUrl}\n${env}`;
writeFileSync('.env', updated);
url.password = '****';
console.log(`Role ${RUNTIME_ROLE} ready. .env DATABASE_URL -> ${url.toString()}`);
