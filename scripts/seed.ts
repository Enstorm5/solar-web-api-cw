// Controlled seed job: `npm run db:seed`. Idempotent; never truncates data.
import pg from 'pg';
import { seedDatabase } from '../src/seed/seed.js';

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('Set MIGRATION_DATABASE_URL (direct connection) or DATABASE_URL.');
  process.exit(1);
}
const anchorEnv = process.env.SEED_ANCHOR_UTC;
const anchorMs = anchorEnv ? Date.parse(anchorEnv) : Date.now();
if (Number.isNaN(anchorMs)) {
  console.error('SEED_ANCHOR_UTC must be an RFC 3339 timestamp.');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
const started = Date.now();
try {
  const s = await seedDatabase(client, {
    anchorMs,
    days: Number(process.env.SEED_DAYS ?? 8),
    randomSeed: process.env.SEED_RANDOM_SEED ?? '20261007',
    installationCount: Number(process.env.SEED_INSTALLATIONS ?? 200),
    log: (m) => console.log(m),
  });
  console.log(
    JSON.stringify(
      {
        anchor_utc: s.anchor,
        start_utc: s.start,
        readings_per_installation: s.readingsPerInstallation,
        readings_generated: s.readingsGenerated,
        readings_inserted: s.readingsInserted,
        duration_s: Math.round((Date.now() - started) / 1000),
      },
      null,
      2,
    ),
  );
} finally {
  await client.end();
}
