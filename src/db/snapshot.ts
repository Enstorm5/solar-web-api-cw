import type pg from 'pg';

/**
 * Runs read queries in one REPEATABLE READ, READ ONLY transaction so a collection's COUNT and
 * its page come from the same snapshot even while devices are inserting readings.
 */
export async function withSnapshot<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
