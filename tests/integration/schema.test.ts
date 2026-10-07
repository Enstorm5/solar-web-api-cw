import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { seedUuid } from '../../src/seed/generate.js';
import { BRIEF_THRESHOLDS, verifySeed } from '../../src/seed/verify.js';
import { testClient } from './db.js';

let db: pg.Client;
const installationId = seedUuid('installation:MTR-000001');

beforeAll(async () => {
  db = testClient();
  await db.connect();
});
afterAll(async () => {
  await db.end();
});

async function pgError(sql: string, params: unknown[] = []): Promise<string | undefined> {
  try {
    await db.query(sql, params);
    return undefined;
  } catch (err) {
    return (err as { code?: string }).code;
  }
}

describe('T12 seed verification', () => {
  it('meets every brief-scale and integrity check', async () => {
    const checks = await verifySeed(db, BRIEF_THRESHOLDS);
    const failed = checks.filter((c) => !c.ok);
    expect(failed, JSON.stringify(failed)).toEqual([]);
    expect(checks.length).toBeGreaterThanOrEqual(13);
  });
});

describe('T01 data invariants', () => {
  it('rejects a duplicate reading for the same installation and timestamp', async () => {
    const { rows } = await db.query(
      'SELECT "timestamp" FROM generation_readings WHERE installation_id = $1 LIMIT 1',
      [installationId],
    );
    const code = await pgError(
      `INSERT INTO generation_readings (installation_id, "timestamp", power_kw, cumulative_energy_kwh, voltage_v)
       VALUES ($1, $2, 1, 1, 230)`,
      [installationId, rows[0].timestamp],
    );
    expect(code).toBe('23505');
  });

  it('makes reading history append-only (UPDATE and DELETE blocked)', async () => {
    expect(
      await pgError('UPDATE generation_readings SET power_kw = 0 WHERE installation_id = $1', [
        installationId,
      ]),
    ).toBe('23001');
    expect(
      await pgError('DELETE FROM generation_readings WHERE installation_id = $1', [installationId]),
    ).toBe('23001');
  });

  it('rejects readings for unknown installations and invalid measurements', async () => {
    const insert = `INSERT INTO generation_readings (installation_id, "timestamp", power_kw, cumulative_energy_kwh, voltage_v)
                    VALUES ($1, '2030-01-01T00:00:00Z', $2, 10, $3)`;
    expect(await pgError(insert, [seedUuid('missing'), 1, 230])).toBe('23503');
    expect(await pgError(insert, [installationId, -1, 230])).toBe('23514');
    expect(await pgError(insert, [installationId, 1, 1001])).toBe('23514');
  });

  it('prevents deleting an installation that has history', async () => {
    const count = async () =>
      (await db.query('SELECT count(*)::int AS n FROM generation_readings WHERE installation_id = $1', [installationId]))
        .rows[0].n as number;
    const before = await count();
    // PostgreSQL 18 reports ON DELETE RESTRICT as 23001 (restrict_violation); 17 used 23503.
    expect(['23001', '23503']).toContain(
      await pgError('DELETE FROM solar_installations WHERE id = $1', [installationId]),
    );
    expect(await count()).toBe(before);
  });

  it('enforces user role and jurisdiction consistency', async () => {
    const code = await pgError(
      `INSERT INTO users (id, subject, display_name, role) VALUES ($1, 'bad-provincial', 'x', 'provincial')`,
      [seedUuid('bad-user')],
    );
    expect(code).toBe('23514');
  });

  it('enforces unique meter ids', async () => {
    const { rows } = await db.query('SELECT substation_id FROM solar_installations WHERE id = $1', [
      installationId,
    ]);
    const code = await pgError(
      `INSERT INTO solar_installations (id, substation_id, meter_id, label, capacity_kw, commissioned_on)
       VALUES ($1, $2, 'MTR-000001', 'dup', 5, '2026-01-01')`,
      [seedUuid('dup-meter'), rows[0].substation_id],
    );
    expect(code).toBe('23505');
  });

  it('runtime role cannot rewrite history or change the hierarchy', async () => {
    const runtime = new pg.Client({ connectionString: inject('runtimeDatabaseUrl') });
    await runtime.connect();
    const denied = async (sql: string) => {
      try {
        await runtime.query(sql);
        return undefined;
      } catch (err) {
        return (err as { code?: string }).code;
      }
    };
    try {
      expect(await denied('UPDATE generation_readings SET power_kw = 0')).toBe('42501');
      expect(await denied('DELETE FROM generation_readings')).toBe('42501');
      expect(await denied('TRUNCATE generation_readings')).toBe('42501');
      expect(await denied("UPDATE provinces SET name = 'x'")).toBe('42501');
      expect(await denied('DROP TABLE users')).toBe('42501');
      expect(await denied('SELECT count(*) FROM generation_readings')).toBeUndefined();
    } finally {
      await runtime.end();
    }
  });

  it('re-running migrations applies nothing', async () => {
    const result = await runMigrations(db);
    expect(result.applied).toEqual([]);
    expect(result.skipped).toContain('001_initial_schema.sql');
  });
});
