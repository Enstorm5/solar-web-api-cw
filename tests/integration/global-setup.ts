import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { rmSync } from 'node:fs';
import type { TestProject } from 'vitest/node';
import { runMigrations } from '../../src/db/migrate.js';
import { seedDatabase } from '../../src/seed/seed.js';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
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
  await client.end();

  project.provide('databaseUrl', url);
  project.provide('seedAnchor', TEST_SEED_ANCHOR);

  return async () => {
    await server.stop();
  };
}
