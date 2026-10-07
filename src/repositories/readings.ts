import type { Queryable } from '../db/types.js';
import type { ScopeParams } from './scope.js';
import { geoConditions, SqlParams, whereClause } from './sql.js';
import { INSTALLATION_FROM, INSTALLATION_GEO } from './installations.js';

export interface Reading {
  id: string;
  installation_id: string;
  timestamp: Date;
  power_kw: number;
  cumulative_energy_kwh: number;
  voltage_v: number;
  received_at: Date;
}

export const READING_COLUMNS =
  'r.id, r.installation_id, r."timestamp", r.power_kw, r.cumulative_energy_kwh, r.voltage_v, r.received_at';

export interface NewReading {
  timestamp: Date;
  power_kw: number;
  cumulative_energy_kwh: number;
  voltage_v: number;
}

export class DuplicateReadingError extends Error {}

/** Appends one reading. The UNIQUE(installation_id, timestamp) constraint makes retries safe. */
export async function insertReading(
  db: Queryable,
  installationId: string,
  r: NewReading,
): Promise<Reading> {
  try {
    const { rows } = await db.query<Reading>(
      `INSERT INTO generation_readings AS r (installation_id, "timestamp", power_kw, cumulative_energy_kwh, voltage_v)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${READING_COLUMNS}`,
      [installationId, r.timestamp, r.power_kw, r.cumulative_energy_kwh, r.voltage_v],
    );
    return rows[0]!;
  } catch (err) {
    if ((err as { code?: string }).code === '23505') throw new DuplicateReadingError();
    throw err;
  }
}

/** A reading is visible only through its own installation and within the reader's jurisdiction. */
export async function getReading(
  db: Queryable,
  scope: ScopeParams,
  installationId: string,
  readingId: string,
): Promise<Reading | undefined> {
  const p = new SqlParams();
  const conds = geoConditions(p, scope, {}, INSTALLATION_GEO);
  conds.push(`i.id = ${p.add(installationId)}`, `r.id = ${p.add(readingId)}`);
  const { rows } = await db.query<Reading>(
    `SELECT ${READING_COLUMNS} FROM generation_readings r JOIN ${INSTALLATION_FROM} ON i.id = r.installation_id
     ${whereClause(conds)}`,
    p.values,
  );
  return rows[0];
}

export interface ReadingQuery {
  installationId?: string;
  provinceId?: string | undefined;
  districtId?: string | undefined;
  substationId?: string | undefined;
  from?: Date | undefined;
  to?: Date | undefined;
  ascending: boolean;
}

/**
 * Scoped, filtered, ordered page of readings plus the total count under the same predicates.
 * Ordering is by observation timestamp with the reading id as a stable tie-breaker in the same
 * direction, so pages never overlap when many installations report at the same instant.
 */
export async function listReadings(
  db: Queryable,
  scope: ScopeParams,
  q: ReadingQuery,
  page: { limit: number; offset: number },
) {
  const p = new SqlParams();
  const conds = geoConditions(
    p,
    scope,
    { provinceId: q.provinceId, districtId: q.districtId, substationId: q.substationId },
    INSTALLATION_GEO,
  );
  if (q.installationId) conds.push(`r.installation_id = ${p.add(q.installationId)}`);
  if (q.from) conds.push(`r."timestamp" >= ${p.add(q.from)}`);
  if (q.to) conds.push(`r."timestamp" < ${p.add(q.to)}`);
  const from = `generation_readings r JOIN ${INSTALLATION_FROM} ON i.id = r.installation_id`;
  const where = whereClause(conds);
  const dir = q.ascending ? 'ASC' : 'DESC';
  const count = await db.query<{ n: number }>(
    `SELECT count(*) AS n FROM ${from} ${where}`,
    p.values,
  );
  const rows = await db.query<Reading>(
    `SELECT ${READING_COLUMNS} FROM ${from} ${where}
     ORDER BY r."timestamp" ${dir}, r.id ${dir} LIMIT ${p.add(page.limit)} OFFSET ${p.add(page.offset)}`,
    p.values,
  );
  return { data: rows.rows, count: count.rows[0]!.n };
}
