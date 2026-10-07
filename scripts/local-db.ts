// Starts a persistent local PostgreSQL 17 (embedded binaries) for development; Ctrl+C to stop.
// Local-only credentials; never used for Neon.
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';
import pg from 'pg';

const dir = '.tmp/pg-dev';
const port = 54320;
const fresh = !existsSync(dir);
const server = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'postgres', port, persistent: true, onLog: () => {} });
if (fresh) await server.initialise();
await server.start();
if (fresh) await server.createDatabase('solar_dev');
const url = `postgres://postgres:postgres@localhost:${port}/solar_dev`;
const c = new pg.Client({ connectionString: url });
await c.connect();
await c.end();
console.log(`Local PostgreSQL ready. DATABASE_URL=${url}`);
const stop = async () => {
  await server.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
