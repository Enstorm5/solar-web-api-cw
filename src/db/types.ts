import type pg from 'pg';

/** Anything that can run a parameterised query: a pool or a checked-out client. */
export type Queryable = Pick<pg.Pool, 'query'> | Pick<pg.PoolClient, 'query'>;
