import type { Queryable } from '../db/types.js';
import type { SiteObservations } from '../services/summary.js';

/**
 * One set-based query for every installation in the district: three LATERAL index lookups on
 * (installation_id, timestamp) per site plus a windowed check for register decreases between the
 * two energy boundaries. No per-installation round trips. The caller has already authorised the
 * district, so this is scoped by district id.
 */
export async function districtObservations(
  db: Queryable,
  districtId: string,
  asOf: Date,
  periodStart: Date,
  periodEnd: Date,
): Promise<SiteObservations[]> {
  const { rows } = await db.query<SiteObservations>(
    `SELECT i.id AS installation_id,
            cur."timestamp" AS current_ts, cur.power_kw AS current_power_kw,
            sb."timestamp" AS start_ts, sb.cumulative_energy_kwh AS start_energy_kwh,
            eb."timestamp" AS end_ts, eb.cumulative_energy_kwh AS end_energy_kwh,
            COALESCE((
              SELECT bool_or(step < 0) FROM (
                SELECT g.cumulative_energy_kwh - lag(g.cumulative_energy_kwh) OVER (ORDER BY g."timestamp") AS step
                  FROM generation_readings g
                 WHERE g.installation_id = i.id
                   AND g."timestamp" >= sb."timestamp" AND g."timestamp" <= eb."timestamp"
              ) steps
            ), false) AS reset_in_period
       FROM solar_installations i
       JOIN grid_substations s ON s.id = i.substation_id
       LEFT JOIN LATERAL (
         SELECT g."timestamp", g.power_kw FROM generation_readings g
          WHERE g.installation_id = i.id AND g."timestamp" <= $2
          ORDER BY g."timestamp" DESC LIMIT 1) cur ON true
       LEFT JOIN LATERAL (
         SELECT g."timestamp", g.cumulative_energy_kwh FROM generation_readings g
          WHERE g.installation_id = i.id AND g."timestamp" <= $3
          ORDER BY g."timestamp" DESC LIMIT 1) sb ON true
       LEFT JOIN LATERAL (
         SELECT g."timestamp", g.cumulative_energy_kwh FROM generation_readings g
          WHERE g.installation_id = i.id AND g."timestamp" <= $4
          ORDER BY g."timestamp" DESC LIMIT 1) eb ON true
      WHERE s.district_id = $1
      ORDER BY i.id`,
    [districtId, asOf, periodStart, periodEnd],
  );
  return rows;
}
