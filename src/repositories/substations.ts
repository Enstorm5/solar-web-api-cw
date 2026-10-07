import type { Queryable } from '../db/types.js';
import type { Page } from '../http/pagination.js';
import type { ScopeParams } from './scope.js';
import { geoConditions, SqlParams, whereClause, type GeoFilters } from './sql.js';

export interface GridSubstation {
  id: string;
  district_id: string;
  code: string;
  name: string;
}

const COLUMNS = 's.id, s.district_id, s.code, s.name';
const FROM = 'grid_substations s JOIN districts d ON d.id = s.district_id';
const GEO = { province: 'd.province_id', district: 'd.id', substation: 's.id' };

export async function listSubstations(db: Queryable, scope: ScopeParams, f: GeoFilters, page: Page) {
  const p = new SqlParams();
  const where = whereClause(geoConditions(p, scope, f, GEO));
  const count = await db.query<{ n: number }>(`SELECT count(*) AS n FROM ${FROM} ${where}`, p.values);
  const rows = await db.query<GridSubstation>(
    `SELECT ${COLUMNS} FROM ${FROM} ${where} ORDER BY s.code, s.id LIMIT ${p.add(page.limit)} OFFSET ${p.add(page.offset)}`,
    p.values,
  );
  return { data: rows.rows, count: count.rows[0]!.n };
}

export async function getSubstation(db: Queryable, scope: ScopeParams, id: string): Promise<GridSubstation | undefined> {
  const p = new SqlParams();
  const where = whereClause(geoConditions(p, scope, { substationId: id }, GEO));
  const { rows } = await db.query<GridSubstation>(`SELECT ${COLUMNS} FROM ${FROM} ${where}`, p.values);
  return rows[0];
}
