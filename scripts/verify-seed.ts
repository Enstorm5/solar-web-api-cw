// `npm run db:verify`: checks seed scale and integrity; exits non-zero on failure.
import pg from 'pg';
import { BRIEF_THRESHOLDS, verifySeed } from '../src/seed/verify.js';

const url = process.env.DATABASE_URL ?? process.env.MIGRATION_DATABASE_URL;
if (!url) {
  console.error('Set DATABASE_URL.');
  process.exit(1);
}
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const checks = await verifySeed(client, BRIEF_THRESHOLDS);
  for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}  (${c.detail})`);
  process.exitCode = checks.every((c) => c.ok) ? 0 : 1;
} finally {
  await client.end();
}
