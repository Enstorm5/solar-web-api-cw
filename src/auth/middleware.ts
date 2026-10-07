import type { RequestHandler, Response } from 'express';
import { errors } from '../http/errors.js';
import type { AppDeps } from '../deps.js';
import { resolvePrincipal, type Principal } from './principal.js';
import { READ_SCOPES, SCOPES, verifyAccessToken, type TokenClaims } from './tokens.js';

export function principalOf(res: Response): Principal {
  const p = res.locals.principal as Principal | undefined;
  if (!p) throw new Error('principalOf called before authenticate');
  return p;
}

/** Verifies the bearer token and resolves the principal from current database state (401 on failure). */
export function authenticate(deps: AppDeps): RequestHandler {
  return async (req, res, next) => {
    try {
      const header = req.get('authorization');
      if (!header) throw errors.authenticationRequired();
      const match = /^Bearer ([A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+)$/.exec(header.trim());
      if (!match) throw errors.invalidToken('Authorization header must be: Bearer <JWT>');

      // Configuration failures must surface as 500, not be disguised as a client token error.
      const verifierConfig = await deps.verifier();
      let claims: TokenClaims;
      try {
        claims = await verifyAccessToken(match[1]!, verifierConfig);
      } catch {
        throw errors.invalidToken();
      }
      const principal = await resolvePrincipal(deps.db(), claims);
      if (!principal) throw errors.invalidToken('Token subject is unknown or no longer active');
      res.locals.principal = principal;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** SLSEA analysts only, with the read scope matching their current role. */
export const requireReader: RequestHandler = (_req, res, next) => {
  const p = principalOf(res);
  const ok = p.kind === 'reader' && READ_SCOPES.some((s) => p.scopes.has(s));
  next(ok ? undefined : errors.insufficientScope(READ_SCOPES.join(' | ')));
};

/** Installation devices only, with installation-write. Installation binding is checked by the route. */
export const requireDeviceWriter: RequestHandler = (_req, res, next) => {
  const p = principalOf(res);
  const ok = p.kind === 'device' && p.scopes.has(SCOPES.INSTALLATION_WRITE);
  next(ok ? undefined : errors.insufficientScope(SCOPES.INSTALLATION_WRITE));
};
