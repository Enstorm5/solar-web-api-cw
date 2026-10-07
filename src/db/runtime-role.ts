import type pg from 'pg';

/** Least-privilege role used by the deployed API (migrations and seeding use the owner role). */
export const RUNTIME_ROLE = 'solar_api';

/**
 * Grants exactly what the API needs: read everything, append readings, manage installation
 * metadata (provisioning principal). No UPDATE/DELETE/TRUNCATE on readings, no DDL.
 * Idempotent; rerun after migrations that add tables.
 */
export async function applyRuntimeGrants(client: pg.ClientBase, role = RUNTIME_ROLE): Promise<void> {
  const r = client.escapeIdentifier(role);
  await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM ${r}`);
  await client.query(`GRANT USAGE ON SCHEMA public TO ${r}`);
  await client.query(
    `GRANT SELECT ON provinces, districts, grid_substations, solar_installations, generation_readings, users TO ${r}`,
  );
  await client.query(`GRANT INSERT ON generation_readings TO ${r}`);
  await client.query(`GRANT INSERT, UPDATE, DELETE ON solar_installations TO ${r}`);
}

/** Creates the role (or rotates its password) with LOGIN only; new roles are never superuser. Neon rejects ALTER ROLE ... NOSUPERUSER from its non-superuser owner, so that clause is omitted. */
export async function ensureRuntimeRole(client: pg.ClientBase, password: string, role = RUNTIME_ROLE): Promise<void> {
  const r = client.escapeIdentifier(role);
  const p = client.escapeLiteral(password);
  const exists = (await client.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [role])).rowCount! > 0;
  await client.query(
    exists
      ? `ALTER ROLE ${r} WITH LOGIN NOCREATEDB NOCREATEROLE PASSWORD ${p}`
      : `CREATE ROLE ${r} WITH LOGIN NOCREATEDB NOCREATEROLE PASSWORD ${p}`,
  );
  await applyRuntimeGrants(client, role);
}
