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
