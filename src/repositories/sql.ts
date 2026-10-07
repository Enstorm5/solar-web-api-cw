import type { ScopeParams } from './scope.js';

/** Collects positional parameters while building a parameterised WHERE clause. */
export class SqlParams {
  readonly values: unknown[] = [];
  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

export interface GeoFilters {
  provinceId?: string | undefined;
  districtId?: string | undefined;
  substationId?: string | undefined;
}

export interface GeoColumns {
  province: string;
  district: string;
  substation?: string;
}

/**
 * Jurisdiction predicates (always applied) followed by caller-supplied geography filters
 * (which can only narrow the result further). Values are bound, never interpolated.
 */
export function geoConditions(p: SqlParams, scope: ScopeParams, f: GeoFilters, cols: GeoColumns): string[] {
  const conds: string[] = [];
  if (scope.provinceId) conds.push(`${cols.province} = ${p.add(scope.provinceId)}`);
  if (scope.districtId) conds.push(`${cols.district} = ${p.add(scope.districtId)}`);
  if (f.provinceId) conds.push(`${cols.province} = ${p.add(f.provinceId)}`);
  if (f.districtId) conds.push(`${cols.district} = ${p.add(f.districtId)}`);
  if (f.substationId) {
    if (!cols.substation) throw new Error('substation filter not supported here');
    conds.push(`${cols.substation} = ${p.add(f.substationId)}`);
  }
  return conds;
}

export const whereClause = (conds: string[]) => (conds.length ? `WHERE ${conds.join(' AND ')}` : '');
