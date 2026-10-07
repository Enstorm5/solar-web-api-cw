import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolvePrincipal } from '../../src/auth/principal.js';
import type { TokenClaims } from '../../src/auth/tokens.js';
import { seedUuid } from '../../src/seed/generate.js';
import { testClient } from './db.js';

let db: pg.Client;
beforeAll(async () => {
  db = testClient();
  await db.connect();
});
afterAll(async () => {
  await db.end();
});

const claims = (principal: 'user' | 'device', sub: string, scope: string): TokenClaims => ({
  principal,
  sub,
  scope,
  scopes: new Set(scope.split(' ')),
});

describe('resolvePrincipal', () => {
  it('binds a device token to an existing active installation', async () => {
    const id = seedUuid('installation:MTR-000001');
    const p = await resolvePrincipal(db, claims('device', id, 'installation-write analyst-read-national'));
    expect(p).toEqual({ kind: 'device', installationId: id, scopes: new Set(['installation-write']) });
  });

  it('rejects devices that are unknown or not UUIDs', async () => {
    expect(await resolvePrincipal(db, claims('device', seedUuid('nope'), 'installation-write'))).toBeUndefined();
    expect(await resolvePrincipal(db, claims('device', 'analyst-national', 'installation-write'))).toBeUndefined();
  });

  it('resolves jurisdiction from the database, including a district user’s province', async () => {
    const p = await resolvePrincipal(db, claims('user', 'analyst-cmb', 'analyst-read-district'));
    expect(p).toMatchObject({
      kind: 'reader',
      jurisdiction: { level: 'district', districtId: seedUuid('district:CMB'), provinceId: seedUuid('province:WP') },
      scopes: new Set(['analyst-read-district']),
    });
  });

  it('intersects token scopes with the user’s current role (no escalation via token scope)', async () => {
    const p = await resolvePrincipal(db, claims('user', 'analyst-cmb', 'analyst-read-national'));
    expect(p?.kind).toBe('reader');
    expect(p?.scopes.size).toBe(0);
  });

  it('drops access for unknown or deactivated users', async () => {
    expect(await resolvePrincipal(db, claims('user', 'nobody', 'analyst-read-national'))).toBeUndefined();
    await db.query(
      `INSERT INTO users (id, subject, display_name, role, active) VALUES ($1, 'revoked-national', 'Revoked', 'national', false)
       ON CONFLICT DO NOTHING`,
      [seedUuid('user:revoked-national')],
    );
    expect(await resolvePrincipal(db, claims('user', 'revoked-national', 'analyst-read-national'))).toBeUndefined();
  });
});
