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
  // Optional: SEED_ANCHOR_UTC + SEED_DAYS restrict series checks to the seeded window, so the
  // verifier still passes after live device readings have been ingested.
  const anchor = process.env.SEED_ANCHOR_UTC ? new Date(process.env.SEED_ANCHOR_UTC) : undefined;
  const days = Number(process.env.SEED_DAYS ?? 8);
  const window = anchor
    ? { from: new Date(anchor.getTime() - days * 86_400_000), to: anchor }
    : undefined;
  const checks = await verifySeed(client, BRIEF_THRESHOLDS, window);
  for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}  (${c.detail})`);
  process.exitCode = checks.every((c) => c.ok) ? 0 : 1;
} finally {
  await client.end();
}
