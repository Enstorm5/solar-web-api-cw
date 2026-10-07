import type { Queryable } from '../db/types.js';
import type { Page } from '../http/pagination.js';
import type { ScopeParams } from './scope.js';

export interface Province {
  id: string;
  code: string;
  name: string;
}

const COLUMNS = 'p.id, p.code, p.name';
// A district-scope user can see its own province record (parent navigation) but nothing wider.
const SCOPE = '($1::uuid IS NULL OR p.id = $1)';

export async function listProvinces(db: Queryable, scope: ScopeParams, page: Page) {
  const count = await db.query<{ n: number }>(`SELECT count(*) AS n FROM provinces p WHERE ${SCOPE}`, [
    scope.provinceId,
  ]);
  const rows = await db.query<Province>(
    `SELECT ${COLUMNS} FROM provinces p WHERE ${SCOPE} ORDER BY p.name, p.id LIMIT $2 OFFSET $3`,
    [scope.provinceId, page.limit, page.offset],
  );
  return { data: rows.rows, count: count.rows[0]!.n };
}

export async function getProvince(db: Queryable, scope: ScopeParams, id: string): Promise<Province | undefined> {
  const { rows } = await db.query<Province>(`SELECT ${COLUMNS} FROM provinces p WHERE ${SCOPE} AND p.id = $2`, [
    scope.provinceId,
    id,
  ]);
  return rows[0];
}
