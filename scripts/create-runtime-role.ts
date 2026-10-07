// `npm run db:runtime-role`: creates/rotates the least-privilege API role using the owner
// connection (MIGRATION_DATABASE_URL), then prints a redacted runtime URL. The new password is
// written to .env as DATABASE_URL (pooled host) when .env targets the same database, otherwise to
// .secrets/runtime-database-url.<host>. Copy it to Vercel from there; it is never printed.
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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

// Only update .env when it already targets the same database host; otherwise a run against a
// different environment (e.g. a local database) would silently replace that environment's only
// local copy of its runtime URL. In that case the URL goes to a separate git-ignored file.
const hostOf = (u: string) => new URL(u).hostname.replace('-pooler.', '.');
const env = readFileSync('.env', 'utf8');
const existing = /^DATABASE_URL=(.*)$/m.exec(env)?.[1]?.trim();
if (!existing || hostOf(existing) === hostOf(runtimeUrl)) {
  writeFileSync(
    '.env',
    existing
      ? env.replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=${runtimeUrl}`)
      : `DATABASE_URL=${runtimeUrl}\n${env}`,
  );
} else {
  mkdirSync('.secrets', { recursive: true });
  const file = `.secrets/runtime-database-url.${url.hostname}`;
  writeFileSync(file, `${runtimeUrl}\n`, { mode: 0o600 });
  console.log(`.env targets a different database; NOT modified. Runtime URL written to ${file}`);
}
url.password = '****';
console.log(`Role ${RUNTIME_ROLE} ready for ${url.toString()}`);
