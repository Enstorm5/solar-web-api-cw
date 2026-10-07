import { createHmac } from 'node:crypto';
import { exportSPKI, generateKeyPair, SignJWT, type CryptoKey } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { normalisePem, signAccessToken, verifyAccessToken, type VerifierConfig } from '../../src/auth/tokens.js';

const issuer = 'https://auth.test/solar';
const audience = 'solar-api';
let privateKey: CryptoKey;
let otherPrivateKey: CryptoKey;
let cfg: VerifierConfig;
let spkiPem: string;

const b64url = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');

beforeAll(async () => {
  const kp = await generateKeyPair('ES256', { extractable: true });
  privateKey = kp.privateKey;
  otherPrivateKey = (await generateKeyPair('ES256')).privateKey;
  spkiPem = await exportSPKI(kp.publicKey);
  cfg = { publicKey: kp.publicKey, issuer, audience };
});

const valid = (over: Partial<Parameters<typeof signAccessToken>[0]> = {}) =>
  signAccessToken({
    privateKey,
    issuer,
    audience,
    subject: 'analyst-national',
    principal: 'user',
    scope: 'analyst-read-national',
    expiresIn: '5m',
    ...over,
  });

describe('verifyAccessToken', () => {
  it('accepts a correctly signed token and splits scopes', async () => {
    const claims = await verifyAccessToken(await valid({ scope: 'a b' }), cfg);
    expect(claims.sub).toBe('analyst-national');
    expect([...claims.scopes]).toEqual(['a', 'b']);
  });

  it('rejects a token signed by another key', async () => {
    await expect(verifyAccessToken(await valid({ privateKey: otherPrivateKey }), cfg)).rejects.toThrow();
  });

  it('rejects wrong issuer, wrong audience and expired tokens', async () => {
    await expect(verifyAccessToken(await valid({ issuer: 'https://evil' }), cfg)).rejects.toThrow();
    await expect(verifyAccessToken(await valid({ audience: 'other' }), cfg)).rejects.toThrow();
    const expired = await new SignJWT({ principal: 'user', scope: 'x' })
      .setProtectedHeader({ alg: 'ES256' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject('s')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 120)
      .sign(privateKey);
    await expect(verifyAccessToken(expired, cfg)).rejects.toThrow();
  });

  it('rejects alg:none tokens', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ iss: issuer, aud: audience, sub: 's', principal: 'user', scope: 'x', iat: now, exp: now + 60 })}.`;
    await expect(verifyAccessToken(token, cfg)).rejects.toThrow();
  });

  it('rejects HS256 algorithm-confusion tokens keyed with the public key', async () => {
    const now = Math.floor(Date.now() / 1000);
    const signingInput = `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ iss: issuer, aud: audience, sub: 's', principal: 'user', scope: 'x', iat: now, exp: now + 60 })}`;
    const sig = createHmac('sha256', spkiPem).update(signingInput).digest('base64url');
    await expect(verifyAccessToken(`${signingInput}.${sig}`, cfg)).rejects.toThrow();
  });

  it('rejects tokens missing principal/scope or with an unknown principal type', async () => {
    const noScope = await new SignJWT({ principal: 'user' })
      .setProtectedHeader({ alg: 'ES256' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject('s')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
    await expect(verifyAccessToken(noScope, cfg)).rejects.toThrow();
    const admin = await new SignJWT({ principal: 'admin', scope: 'x' })
      .setProtectedHeader({ alg: 'ES256' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject('s')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
    await expect(verifyAccessToken(admin, cfg)).rejects.toThrow();
  });
});

describe('normalisePem', () => {
  it('accepts escaped-newline and base64 forms', () => {
    const escaped = spkiPem.replace(/\n/g, '\\n');
    expect(normalisePem(escaped)).toBe(spkiPem.trim());
    expect(normalisePem(Buffer.from(spkiPem).toString('base64'))).toBe(spkiPem.trim());
  });
});
