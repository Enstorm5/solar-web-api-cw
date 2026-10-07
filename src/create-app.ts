import express, { Router } from 'express';
import { authenticate } from './auth/middleware.js';
import type { AppDeps } from './deps.js';
import { errors } from './http/errors.js';
import { accessLog, errorHandler, requestId, routeNotFound, securityHeaders } from './http/middleware.js';
import { requireJsonAcceptable } from './http/negotiate.js';
import { docsRoutes } from './routes/docs.js';
import { provinceRoutes } from './routes/provinces.js';
import { asyncHandler } from './routes/route.js';

export const BASE_PATH = '/solar/v1.0';

/** Configures an Express instance (created by the caller so Vercel's entrypoint detection sees it). */
export function createApp(deps: AppDeps, app: express.Express = express()): express.Express {
  app.disable('x-powered-by');
  app.set('etag', false); // validators are computed explicitly in sendRepresentation

  app.use(requestId, accessLog, securityHeaders);

  app.get('/health/live', (_req, res) => {
    res.set('Cache-Control', 'no-store').json({ status: 'ok' });
  });
  app.get(
    '/health/ready',
    asyncHandler(async (_req, res) => {
      try {
        await deps.db().query('SELECT 1');
      } catch (err) {
        // Log the cause for operators (names/messages only, never connection strings or keys).
        console.error(JSON.stringify({ level: 'error', check: 'ready', error: `${(err as Error).name}: ${(err as Error).message}` }));
        throw errors.unavailable();
      }
      res.set('Cache-Control', 'no-store').json({ status: 'ok' });
    }),
  );

  app.use(docsRoutes());

  // Precedence: authentication (401) -> negotiation (406) -> route capability (403) -> validation (400)
  // -> scoped lookup (404). Unauthenticated callers learn nothing about which routes exist.
  const api = Router();
  api.use(authenticate(deps), requireJsonAcceptable);
  api.use(provinceRoutes(deps));
  api.use(routeNotFound);
  app.use(BASE_PATH, api);

  app.use(routeNotFound);
  app.use(errorHandler);
  return app;
}
