import type { Queryable } from '../db/types.js';
import { READ_SCOPES, SCOPES, type TokenClaims } from './tokens.js';

export type Jurisdiction =
  | { level: 'national' }
  | { level: 'province'; provinceId: string }
  | { level: 'district'; districtId: string; provinceId: string };

export type Principal =
  | { kind: 'device'; installationId: string; scopes: Set<string> }
  | { kind: 'reader'; userId: string; jurisdiction: Jurisdiction; scopes: Set<string> };

const ROLE_SCOPE = {
  national: SCOPES.READ_NATIONAL,
  provincial: SCOPES.READ_PROVINCE,
  district: SCOPES.READ_DISTRICT,
} as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Turns verified token claims into a principal using current database state, so revoked users or
 * deactivated installations lose access even while their token is unexpired. Effective scopes are
 * the intersection of token scopes and what the database record currently permits.
 * Returns undefined when the subject is unknown or inactive.
 */
export async function resolvePrincipal(db: Queryable, claims: TokenClaims): Promise<Principal | undefined> {
  if (claims.principal === 'device') {
    if (!UUID_RE.test(claims.sub)) return undefined;
    const { rows } = await db.query<{ id: string }>(
      'SELECT id FROM solar_installations WHERE id = $1 AND active',
      [claims.sub],
    );
    if (rows.length === 0) return undefined;
    const scopes = new Set([...claims.scopes].filter((s) => s === SCOPES.INSTALLATION_WRITE));
    return { kind: 'device', installationId: rows[0]!.id, scopes };
  }

  const { rows } = await db.query<{
    id: string;
    role: keyof typeof ROLE_SCOPE;
    province_id: string | null;
    district_id: string | null;
    district_province_id: string | null;
  }>(
    `SELECT u.id, u.role, u.province_id, u.district_id, d.province_id AS district_province_id
       FROM users u LEFT JOIN districts d ON d.id = u.district_id
      WHERE u.subject = $1 AND u.active`,
    [claims.sub],
  );
  const user = rows[0];
  if (!user) return undefined;
  const jurisdiction: Jurisdiction =
    user.role === 'national'
      ? { level: 'national' }
      : user.role === 'provincial'
        ? { level: 'province', provinceId: user.province_id! }
        : { level: 'district', districtId: user.district_id!, provinceId: user.district_province_id! };
  const allowed = ROLE_SCOPE[user.role];
  const scopes = new Set([...claims.scopes].filter((s) => s === allowed && READ_SCOPES.includes(s)));
  return { kind: 'reader', userId: user.id, jurisdiction, scopes };
}
