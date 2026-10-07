import type { Queryable } from '../db/types.js';
import type { District } from './districts.js';
import { INSTALLATION_COLUMNS, INSTALLATION_GEO, type Installation } from './installations.js';
import type { Province } from './provinces.js';
import { latestReading, type Reading } from './readings.js';
import type { ScopeParams } from './scope.js';
import { geoConditions, SqlParams, whereClause } from './sql.js';
import type { GridSubstation } from './substations.js';

export interface InstallationOverview {
  installation: Installation;
  grid_substation: GridSubstation;
  district: District;
  province: Province;
  last_known_reading: Reading | null;
}

type Row = Installation & {
  s_code: string;
  s_name: string;
  d_id: string;
  d_code: string;
  d_name: string;
  p_id: string;
  p_code: string;
  p_name: string;
};

/**
 * Composite resource: the installation, its full hierarchy and one bounded latest reading.
 * Columns are mapped in TypeScript (not json_build_object) so timestamps serialise exactly as on
 * every other endpoint (RFC 3339 UTC), independent of the database session time zone.
 */
export async function getOverview(
  db: Queryable,
  scope: ScopeParams,
  installationId: string,
): Promise<InstallationOverview | undefined> {
  const p = new SqlParams();
  const conds = geoConditions(p, scope, {}, INSTALLATION_GEO);
  conds.push(`i.id = ${p.add(installationId)}`);
  const { rows } = await db.query<Row>(
    `SELECT ${INSTALLATION_COLUMNS},
            s.code AS s_code, s.name AS s_name,
            d.id AS d_id, d.code AS d_code, d.name AS d_name,
            pr.id AS p_id, pr.code AS p_code, pr.name AS p_name
     FROM solar_installations i
     JOIN grid_substations s ON s.id = i.substation_id
     JOIN districts d ON d.id = s.district_id
     JOIN provinces pr ON pr.id = d.province_id
     ${whereClause(conds)}`,
    p.values,
  );
  const r = rows[0];
  if (!r) return undefined;
  return {
    installation: {
      id: r.id,
      substation_id: r.substation_id,
      meter_id: r.meter_id,
      label: r.label,
      capacity_kw: r.capacity_kw,
      commissioned_on: r.commissioned_on,
      active: r.active,
      created_at: r.created_at,
      updated_at: r.updated_at,
    },
    grid_substation: { id: r.substation_id, district_id: r.d_id, code: r.s_code, name: r.s_name },
    district: { id: r.d_id, province_id: r.p_id, code: r.d_code, name: r.d_name },
    province: { id: r.p_id, code: r.p_code, name: r.p_name },
    last_known_reading: (await latestReading(db, installationId)) ?? null,
  };
}
