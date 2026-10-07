import type { Jurisdiction } from '../auth/principal.js';

/**
 * Jurisdiction as SQL parameters. Every hierarchy/reading query joins down to district and
 * province and applies `($p::uuid IS NULL OR province_id = $p) AND ($d::uuid IS NULL OR district_id = $d)`,
 * so scope is enforced before rows are selected, counted or aggregated.
 */
export interface ScopeParams {
  provinceId: string | null;
  districtId: string | null;
}

export function scopeParams(j: Jurisdiction): ScopeParams {
  switch (j.level) {
    case 'national':
      return { provinceId: null, districtId: null };
    case 'province':
      return { provinceId: j.provinceId, districtId: null };
    case 'district':
      return { provinceId: j.provinceId, districtId: j.districtId };
  }
}
