import { attachDatabasePool } from '@vercel/functions';
import pg from 'pg';
import { z } from 'zod';
import { importPublicKey, type VerifierConfig } from './auth/tokens.js';

/** Dependencies are created lazily so importing the app never fails on missing configuration. */
export interface AppDeps {
  db(): pg.Pool;
  verifier(): Promise<VerifierConfig>;
}

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  JWT_PUBLIC_KEY: z.string().min(1),
  JWT_ISSUER: z.string().min(1),
  JWT_AUDIENCE: z.string().min(1),
});

export class ConfigError extends Error {}

function readEnv(env: NodeJS.ProcessEnv) {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    // Names only; values are never logged.
    const missing = parsed.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new ConfigError(`Missing or invalid configuration: ${missing}`);
  }
  return parsed.data;
}

// pg returns NUMERIC as strings by default; measurements are bounded so float64 is exact enough
// for numeric(14,3). Registered globally because both runtime and scripts use the same parser.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

export function createPool(connectionString: string): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on('error', (err) => console.error('pg pool error', err.message));
  return pool;
}

export function envDeps(env: NodeJS.ProcessEnv = process.env): AppDeps {
  let pool: pg.Pool | undefined;
  let verifier: Promise<VerifierConfig> | undefined;
  return {
    db() {
      if (!pool) {
        pool = createPool(readEnv(env).DATABASE_URL);
        attachDatabasePool(pool);
      }
      return pool;
    },
    verifier() {
      if (!verifier) {
        const cfg = readEnv(env);
        verifier = importPublicKey(cfg.JWT_PUBLIC_KEY).then((publicKey) => ({
          publicKey,
          issuer: cfg.JWT_ISSUER,
          audience: cfg.JWT_AUDIENCE,
        }));
        verifier.catch(() => {
          verifier = undefined;
        });
      }
      return verifier;
    },
  };
}
