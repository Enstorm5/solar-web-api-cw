import pg from 'pg';
import { inject } from 'vitest';

export function testClient(): pg.Client {
  return new pg.Client({ connectionString: inject('databaseUrl') });
}
