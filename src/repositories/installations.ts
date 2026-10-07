import type { Queryable } from '../db/types.js';
import type { Page } from '../http/pagination.js';
import type { ScopeParams } from './scope.js';
import { geoConditions, SqlParams, whereClause, type GeoFilters } from './sql.js';

export interface Installation {
  id: string;
  substation_id: string;
  meter_id: string;
  label: string;
  capacity_kw: number;
  commissioned_on: string;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

export const INSTALLATION_COLUMNS =
  'i.id, i.substation_id, i.meter_id, i.label, i.capacity_kw, i.commissioned_on, i.active, i.created_at, i.updated_at';
export const INSTALLATION_FROM =
  'solar_installations i JOIN grid_substations s ON s.id = i.substation_id JOIN districts d ON d.id = s.district_id';
export const INSTALLATION_GEO = { province: 'd.province_id', district: 'd.id', substation: 's.id' };

export async function listInstallations(
  db: Queryable,
  scope: ScopeParams,
  f: GeoFilters,
  page: Page,
) {
  const p = new SqlParams();
  const where = whereClause(geoConditions(p, scope, f, INSTALLATION_GEO));
  const count = await db.query<{ n: number }>(
    `SELECT count(*) AS n FROM ${INSTALLATION_FROM} ${where}`,
    p.values,
  );
  const rows = await db.query<Installation>(
    `SELECT ${INSTALLATION_COLUMNS} FROM ${INSTALLATION_FROM} ${where}
     ORDER BY i.meter_id, i.id LIMIT ${p.add(page.limit)} OFFSET ${p.add(page.offset)}`,
    p.values,
  );
  return { data: rows.rows, count: count.rows[0]!.n };
}

/** Scoped lookup: returns undefined for both nonexistent and out-of-jurisdiction installations. */
export async function getInstallation(
  db: Queryable,
  scope: ScopeParams,
  id: string,
): Promise<Installation | undefined> {
  const p = new SqlParams();
  const conds = geoConditions(p, scope, {}, INSTALLATION_GEO);
  conds.push(`i.id = ${p.add(id)}`);
  const { rows } = await db.query<Installation>(
    `SELECT ${INSTALLATION_COLUMNS} FROM ${INSTALLATION_FROM} ${whereClause(conds)}`,
    p.values,
  );
  return rows[0];
}
