import pg from 'pg';
import { rmSync } from 'node:fs';
import type { TestProject } from 'vitest/node';

// embedded-postgres registers async-exit-hook, whose `beforeExit` handler calls process.exit(0)
// and so overwrote vitest's failing exit code (a failing run exited 0). Drop only that listener;
// teardown below stops PostgreSQL explicitly, and the signal handlers stay in place.
const beforeExitListeners = process.listeners('beforeExit');
const { default: EmbeddedPostgres } = await import('embedded-postgres');
for (const listener of process.listeners('beforeExit')) {
  if (!beforeExitListeners.includes(listener)) process.off('beforeExit', listener);
}
import { runMigrations } from '../../src/db/migrate.js';
import { ensureRuntimeRole, RUNTIME_ROLE } from '../../src/db/runtime-role.js';
import { seedDatabase } from '../../src/seed/seed.js';

declare module 'vitest' {
  export interface ProvidedContext {
    /** Owner/superuser connection (schema tests, fixtures). */
    databaseUrl: string;
    /** Least-privilege connection used by the API under test, as in production. */
    runtimeDatabaseUrl: string;
    seedAnchor: string;
  }
}

const PORT = 54330;
const DATA_DIR = '.tmp/pg-test';
// Fixed anchor so test expectations are reproducible.
export const TEST_SEED_ANCHOR = '2026-10-01T00:00:00Z';

export default async function setup(project: TestProject) {
  rmSync(DATA_DIR, { recursive: true, force: true });
  const server = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: 'postgres',
    password: 'postgres',
    port: PORT,
    persistent: false,
    onLog: () => {},
  });
  await server.initialise();
  await server.start();
  await server.createDatabase('solar_test');
  const url = `postgres://postgres:postgres@localhost:${PORT}/solar_test`;

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await runMigrations(client);
  await seedDatabase(client, {
    anchorMs: Date.parse(TEST_SEED_ANCHOR),
    days: 8,
    randomSeed: 'integration-test',
    installationCount: 200,
  });
  await ensureRuntimeRole(client, 'runtime-test-password');
  await client.end();

  project.provide('databaseUrl', url);
  project.provide('runtimeDatabaseUrl', `postgres://${RUNTIME_ROLE}:runtime-test-password@localhost:${PORT}/solar_test`);
  project.provide('seedAnchor', TEST_SEED_ANCHOR);

  return async () => {
    await server.stop();
  };
}
