import type pg from 'pg';
import { etagFor } from '../http/respond.js';
import { INSTALLATION_COLUMNS, type Installation } from './installations.js';

export interface InstallationWrite {
  substation_id: string;
  meter_id: string;
  label: string;
  capacity_kw: number;
  commissioned_on: string;
  active: boolean;
}

export type AdminOutcome<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'not-found' }
  | { kind: 'precondition-failed' }
  | { kind: 'unknown-substation' }
  | { kind: 'duplicate-meter' }
  | { kind: 'history-protected'; fields: string[] }
  | { kind: 'has-readings' };

/** Strong comparison (RFC 9110 section 13.1.1): `*` or an exact, non-weak match. */
export function ifMatchSatisfied(header: string, currentEtag: string): boolean {
  if (header.trim() === '*') return true;
  return header
    .split(',')
    .map((t) => t.trim())
    .some((t) => !t.startsWith('W/') && t === currentEtag);
}

async function inTransaction<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const result = await fn(c);
    await c.query('COMMIT');
    return result;
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

const isUniqueViolation = (err: unknown) => (err as { code?: string }).code === '23505';
const isRestrictViolation = (err: unknown) =>
  ['23001', '23503'].includes((err as { code?: string }).code ?? '');

async function substationExists(c: pg.PoolClient, id: string): Promise<boolean> {
  return ((await c.query('SELECT 1 FROM grid_substations WHERE id = $1', [id])).rowCount ?? 0) > 0;
}

async function lockCurrent(c: pg.PoolClient, id: string) {
  const { rows } = await c.query<Installation>(
    `SELECT ${INSTALLATION_COLUMNS} FROM solar_installations i WHERE i.id = $1 FOR UPDATE`,
    [id],
  );
  return rows[0];
}

const hasReadings = async (c: pg.PoolClient, id: string) =>
  ((await c.query('SELECT 1 FROM generation_readings WHERE installation_id = $1 LIMIT 1', [id]))
    .rowCount ?? 0) > 0;

export async function createInstallation(
  pool: pg.Pool,
  w: InstallationWrite,
): Promise<AdminOutcome<Installation>> {
  return inTransaction(pool, async (c) => {
    if (!(await substationExists(c, w.substation_id))) return { kind: 'unknown-substation' };
    try {
      const { rows } = await c.query<Installation>(
        `INSERT INTO solar_installations AS i (id, substation_id, meter_id, label, capacity_kw, commissioned_on, active)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
         RETURNING ${INSTALLATION_COLUMNS}`,
        [w.substation_id, w.meter_id, w.label, w.capacity_kw, w.commissioned_on, w.active],
      );
      return { kind: 'ok', value: rows[0]! };
    } catch (err) {
      if (isUniqueViolation(err)) return { kind: 'duplicate-meter' };
      throw err;
    }
  });
}

/**
 * Complete replacement under optimistic concurrency. The row lock serialises concurrent PUTs, so
 * of two writers holding the same ETag exactly one succeeds and the other gets 412.
 */
export async function replaceInstallation(
  pool: pg.Pool,
  id: string,
  ifMatch: string,
  w: InstallationWrite,
): Promise<AdminOutcome<Installation>> {
  return inTransaction(pool, async (c) => {
    const current = await lockCurrent(c, id);
    if (!current) return { kind: 'not-found' };
    if (!ifMatchSatisfied(ifMatch, etagFor(JSON.stringify(current))))
      return { kind: 'precondition-failed' };

    const unchanged =
      current.substation_id === w.substation_id &&
      current.meter_id === w.meter_id &&
      current.label === w.label &&
      current.capacity_kw === w.capacity_kw &&
      current.commissioned_on === w.commissioned_on &&
      current.active === w.active;
    // A no-op PUT leaves the representation, and therefore its validator, untouched.
    if (unchanged) return { kind: 'ok', value: current };

    if (
      current.substation_id !== w.substation_id &&
      !(await substationExists(c, w.substation_id))
    ) {
      return { kind: 'unknown-substation' };
    }
    // Re-parenting or re-metering a site with history would silently rewrite regional reports.
    const protectedChanges = [
      ...(current.substation_id !== w.substation_id ? ['substation_id'] : []),
      ...(current.meter_id !== w.meter_id ? ['meter_id'] : []),
    ];
    if (protectedChanges.length > 0 && (await hasReadings(c, id))) {
      return { kind: 'history-protected', fields: protectedChanges };
    }
    try {
      const { rows } = await c.query<Installation>(
        `UPDATE solar_installations AS i
            SET substation_id = $2, meter_id = $3, label = $4, capacity_kw = $5, commissioned_on = $6,
                active = $7, version = version + 1, updated_at = now()
          WHERE i.id = $1
          RETURNING ${INSTALLATION_COLUMNS}`,
        [id, w.substation_id, w.meter_id, w.label, w.capacity_kw, w.commissioned_on, w.active],
      );
      return { kind: 'ok', value: rows[0]! };
    } catch (err) {
      if (isUniqueViolation(err)) return { kind: 'duplicate-meter' };
      throw err;
    }
  });
}

/** Deletes an installation only if it has never reported; history is never cascaded away. */
export async function deleteInstallation(
  pool: pg.Pool,
  id: string,
  ifMatch: string,
): Promise<AdminOutcome<{ id: string }>> {
  return inTransaction(pool, async (c) => {
    const current = await lockCurrent(c, id);
    if (!current) return { kind: 'not-found' };
    if (!ifMatchSatisfied(ifMatch, etagFor(JSON.stringify(current))))
      return { kind: 'precondition-failed' };
    if (await hasReadings(c, id)) return { kind: 'has-readings' };
    try {
      await c.query('DELETE FROM solar_installations WHERE id = $1', [id]);
    } catch (err) {
      // Defence in depth: a reading inserted concurrently is still protected by the FK.
      if (isRestrictViolation(err)) return { kind: 'has-readings' };
      throw err;
    }
    return { kind: 'ok', value: { id } };
  });
}
