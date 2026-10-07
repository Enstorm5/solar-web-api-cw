import type { Queryable } from '../db/types.js';
import type { Page } from '../http/pagination.js';
import type { ScopeParams } from './scope.js';
import { geoConditions, SqlParams, whereClause, type GeoFilters } from './sql.js';

export interface District {
  id: string;
  province_id: string;
  code: string;
  name: string;
}

const COLUMNS = 'd.id, d.province_id, d.code, d.name';
const GEO = { province: 'd.province_id', district: 'd.id' };

export async function listDistricts(db: Queryable, scope: ScopeParams, f: GeoFilters, page: Page) {
  const p = new SqlParams();
  const where = whereClause(geoConditions(p, scope, f, GEO));
  const count = await db.query<{ n: number }>(`SELECT count(*) AS n FROM districts d ${where}`, p.values);
  const rows = await db.query<District>(
    `SELECT ${COLUMNS} FROM districts d ${where} ORDER BY d.name, d.id LIMIT ${p.add(page.limit)} OFFSET ${p.add(page.offset)}`,
    p.values,
  );
  return { data: rows.rows, count: count.rows[0]!.n };
}

export async function getDistrict(db: Queryable, scope: ScopeParams, id: string): Promise<District | undefined> {
  const p = new SqlParams();
  const conds = geoConditions(p, scope, { districtId: id }, GEO);
  const { rows } = await db.query<District>(`SELECT ${COLUMNS} FROM districts d ${whereClause(conds)}`, p.values);
  return rows[0];
}
