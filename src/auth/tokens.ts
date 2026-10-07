import { importPKCS8, importSPKI, jwtVerify, SignJWT, type CryptoKey } from 'jose';
import { z } from 'zod';

export const ALGORITHM = 'ES256';

export const SCOPES = {
  INSTALLATION_WRITE: 'installation-write',
  READ_NATIONAL: 'analyst-read-national',
  READ_PROVINCE: 'analyst-read-province',
  READ_DISTRICT: 'analyst-read-district',
  INSTALLATION_MANAGE: 'installation-manage',
} as const;

export const READ_SCOPES: readonly string[] = [
  SCOPES.READ_NATIONAL,
  SCOPES.READ_PROVINCE,
  SCOPES.READ_DISTRICT,
];

const claimsSchema = z.object({
  sub: z.string().min(1).max(100),
  principal: z.enum(['device', 'user', 'service']),
  scope: z.string().min(1).max(500),
});

export type TokenClaims = z.infer<typeof claimsSchema> & { scopes: Set<string> };

export interface VerifierConfig {
  publicKey: CryptoKey;
  issuer: string;
  audience: string;
}

/** Accepts PEM with real or escaped newlines, or base64-encoded PEM (convenient for env vars). */
export function normalisePem(value: string): string {
  const v = value.trim();
  if (v.startsWith('-----')) return v.replace(/\\n/g, '\n');
  return Buffer.from(v, 'base64').toString('utf8').trim();
}

export async function importPublicKey(pem: string): Promise<CryptoKey> {
  return importSPKI(normalisePem(pem), ALGORITHM);
}

export async function importPrivateKey(pem: string): Promise<CryptoKey> {
  return importPKCS8(normalisePem(pem), ALGORITHM, { extractable: true });
}

/**
 * Verifies signature (ES256 only, so `alg: none` and HMAC key-confusion tokens are rejected),
 * issuer, audience, expiry/not-before, then validates claim types. Never trusts decoded-only data.
 */
export async function verifyAccessToken(token: string, cfg: VerifierConfig): Promise<TokenClaims> {
  const { payload } = await jwtVerify(token, cfg.publicKey, {
    algorithms: [ALGORITHM],
    issuer: cfg.issuer,
    audience: cfg.audience,
    requiredClaims: ['sub', 'iat', 'exp'],
    clockTolerance: 30,
  });
  const claims = claimsSchema.parse(payload);
  return { ...claims, scopes: new Set(claims.scope.split(' ').filter(Boolean)) };
}

export interface SignOptions {
  privateKey: CryptoKey;
  issuer: string;
  audience: string;
  subject: string;
  principal: 'device' | 'user' | 'service';
  scope: string;
  expiresIn: string | number;
  /** Key id (JWK thumbprint of the signing key) to support future key rotation. */
  kid?: string;
}

export async function signAccessToken(o: SignOptions): Promise<string> {
  return new SignJWT({ principal: o.principal, scope: o.scope })
    .setProtectedHeader({ alg: ALGORITHM, typ: 'JWT', ...(o.kid ? { kid: o.kid } : {}) })
    .setIssuer(o.issuer)
    .setAudience(o.audience)
    .setSubject(o.subject)
    .setIssuedAt()
    .setExpirationTime(o.expiresIn)
    .sign(o.privateKey);
}
