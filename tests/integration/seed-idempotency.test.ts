import { describe, expect, inject, it } from 'vitest';
import { seedDatabase } from '../../src/seed/seed.js';
import { testClient } from './db.js';

describe('seed rerun', () => {
  it('inserts no duplicate rows when run again with the same configuration', async () => {
    const db = testClient();
    await db.connect();
    try {
      const count = async () =>
        (await db.query('SELECT count(*)::int AS n FROM generation_readings')).rows[0].n as number;
      const before = await count();
      const s = await seedDatabase(db, {
        anchorMs: Date.parse(inject('seedAnchor')),
        days: 8,
        randomSeed: 'integration-test',
        installationCount: 200,
      });
      expect(s.readingsInserted).toBe(0);
      expect(await count()).toBe(before);
    } finally {
      await db.end();
    }
  });
});
