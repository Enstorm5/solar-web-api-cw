// Controlled migration job: `npm run db:migrate`. Never run from the API process.
import pg from 'pg';
import { runMigrations } from '../src/db/migrate.js';

const url = process.env.MIGRATION_DATABASE_URL ?? process.env.DATABASE_URL;
if (!url) {
  console.error('Set MIGRATION_DATABASE_URL (direct connection) or DATABASE_URL.');
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const { applied, skipped } = await runMigrations(client);
  console.log(`Applied: ${applied.join(', ') || 'none'}; already applied: ${skipped.length}`);
} finally {
  await client.end();
}
