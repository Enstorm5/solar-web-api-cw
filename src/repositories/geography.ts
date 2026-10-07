import type { Queryable } from '../db/types.js';
import { ErrorCode, errors, type ErrorItem } from '../http/errors.js';
import type { ScopeParams } from './scope.js';
import { geoConditions, SqlParams, whereClause, type GeoFilters } from './sql.js';

/**
 * Rejects contradictory geography filters (e.g. district-id not inside province-id) with 400.
 * Only objects already visible to the caller are inspected; a foreign or unknown narrower id is
 * not an error here — it simply yields an empty, correctly scoped result.
 */
export async function assertConsistentGeography(
  db: Queryable,
  scope: ScopeParams,
  f: GeoFilters,
): Promise<void> {
  const items: ErrorItem[] = [];
  const mismatch = (field: string, parent: string) =>
    items.push({
      code: ErrorCode.INVALID_QUERY,
      field,
      message: `Not located in the given ${parent}`,
    });

  if (f.substationId && (f.districtId || f.provinceId)) {
    const p = new SqlParams();
    const where = whereClause(
      geoConditions(
        p,
        scope,
        { substationId: f.substationId },
        { province: 'd.province_id', district: 'd.id', substation: 's.id' },
      ),
    );
    const { rows } = await db.query<{ district_id: string; province_id: string }>(
      `SELECT d.id AS district_id, d.province_id FROM grid_substations s JOIN districts d ON d.id = s.district_id ${where}`,
      p.values,
    );
    const s = rows[0];
    if (s && f.districtId && s.district_id !== f.districtId)
      mismatch('substation-id', 'district-id');
    if (s && f.provinceId && s.province_id !== f.provinceId)
      mismatch('substation-id', 'province-id');
  }
  if (f.districtId && f.provinceId) {
    const p = new SqlParams();
    const where = whereClause(
      geoConditions(
        p,
        scope,
        { districtId: f.districtId },
        { province: 'd.province_id', district: 'd.id' },
      ),
    );
    const { rows } = await db.query<{ province_id: string }>(
      `SELECT d.province_id FROM districts d ${where}`,
      p.values,
    );
    if (rows[0] && rows[0].province_id !== f.provinceId) mismatch('district-id', 'province-id');
  }
  if (items.length > 0) throw errors.invalidQuery(items);
}
