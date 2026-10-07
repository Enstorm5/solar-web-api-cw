import { generateKeyPair, type CryptoKey } from 'jose';
import type pg from 'pg';
import { inject } from 'vitest';
import { signAccessToken, type VerifierConfig } from '../../src/auth/tokens.js';
import { createApp } from '../../src/create-app.js';
import { createPool, type AppDeps } from '../../src/deps.js';
import { seedUuid } from '../../src/seed/generate.js';

export const ISSUER = 'https://auth.test/solar';
export const AUDIENCE = 'solar-api';

export interface TestApp {
  app: ReturnType<typeof createApp>;
  pool: pg.Pool;
  privateKey: CryptoKey;
  token(
    principal: 'user' | 'device' | 'service',
    sub: string,
    scope: string,
    ttl?: string,
  ): Promise<string>;
  reader(subject: keyof typeof READERS): Promise<string>;
  device(meterId: string): Promise<string>;
  close(): Promise<void>;
}

export const READERS = {
  national: ['analyst-national', 'analyst-read-national'],
  wp: ['analyst-wp', 'analyst-read-province'],
  cp: ['analyst-cp', 'analyst-read-province'],
  cmb: ['analyst-cmb', 'analyst-read-district'],
  kdy: ['analyst-kdy', 'analyst-read-district'],
} as const;

export async function buildTestApp(): Promise<TestApp> {
  const { publicKey, privateKey } = await generateKeyPair('ES256');
  const pool = createPool(inject('runtimeDatabaseUrl'));
  const verifier: VerifierConfig = { publicKey, issuer: ISSUER, audience: AUDIENCE };
  const deps: AppDeps = { db: () => pool, verifier: async () => verifier };
  const token = (
    principal: 'user' | 'device' | 'service',
    sub: string,
    scope: string,
    ttl = '5m',
  ) =>
    signAccessToken({
      privateKey,
      issuer: ISSUER,
      audience: AUDIENCE,
      subject: sub,
      principal,
      scope,
      expiresIn: ttl,
    });
  return {
    app: createApp(deps),
    pool,
    privateKey,
    token,
    reader: (k) => token('user', READERS[k][0], READERS[k][1]),
    device: (meterId) => token('device', seedUuid(`installation:${meterId}`), 'installation-write'),
    close: () => pool.end(),
  };
}

export const ids = {
  province: (code: string) => seedUuid(`province:${code}`),
  district: (code: string) => seedUuid(`district:${code}`),
  substation: (code: string) => seedUuid(`substation:${code}`),
  installation: (meterId: string) => seedUuid(`installation:${meterId}`),
};
