import type { RequestHandler, Response, Router } from 'express';
import { principalOf } from '../auth/middleware.js';
import { methodNotAllowed } from '../http/middleware.js';
import { scopeParams, type ScopeParams } from '../repositories/scope.js';

type Handlers = Partial<
  Record<'get' | 'post' | 'put' | 'delete', RequestHandler | RequestHandler[]>
>;

/** Registers handlers for one URI template and answers every other method with 405 + Allow. */
export function resource(router: Router, path: string, handlers: Handlers): void {
  const allow: string[] = [];
  for (const [method, h] of Object.entries(handlers)) {
    allow.push(method.toUpperCase());
    router[method as keyof Handlers](path, ...(Array.isArray(h) ? h : [h!]));
  }
  router.all(path, methodNotAllowed(allow));
}

/** Wraps an async handler so rejections reach the error middleware. */
export const asyncHandler =
  (fn: (...args: Parameters<RequestHandler>) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

/**
 * Jurisdiction of the authenticated caller as SQL scope parameters. The provisioning service has
 * national visibility of installation metadata only (routes decide where it is admitted).
 */
export function readerScope(res: Response): ScopeParams {
  const p = principalOf(res);
  if (p.kind === 'reader') return scopeParams(p.jurisdiction);
  if (p.kind === 'service') return { provinceId: null, districtId: null };
  throw new Error('reader or service principal expected');
}
