import { randomUUID } from 'node:crypto';
import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import { ApiError, errors } from './errors.js';

export const requestId: RequestHandler = (_req, res, next) => {
  const id = randomUUID();
  res.locals.requestId = id;
  res.set('X-Request-Id', id);
  next();
};

/** One structured log line per request; never logs headers, bodies or tokens. */
export const accessLog: RequestHandler = (req, res, next) => {
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : 'unmatched';
    console.log(
      JSON.stringify({ request_id: res.locals.requestId, method: req.method, route, status: res.statusCode, ms: Math.round(ms) }),
    );
  });
  next();
};

export const securityHeaders: RequestHandler = (_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  });
  next();
};

const parseJson = express.json({ limit: '16kb', strict: true, type: () => true });

/** For POST/PUT: 415 unless Content-Type is application/json, then parse (400/413 on failure). */
export const jsonBody: RequestHandler[] = [
  (req, _res, next) => next(req.is('application/json') ? undefined : errors.unsupportedMediaType()),
  parseJson,
];

/** Registers the supported methods for a path; every other method gets 405 with Allow. */
export function methodNotAllowed(allow: string[]): RequestHandler {
  const header = [...new Set([...allow, ...(allow.includes('GET') ? ['HEAD'] : [])])];
  return (_req, _res, next) => next(errors.methodNotAllowed(header));
}

const DB_UNAVAILABLE = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'ENOTFOUND', 'ECONNRESET', '57P01', '57P03', '53300', '08006', '08001']);

function toApiError(err: unknown): ApiError | undefined {
  if (err instanceof ApiError) return err;
  const e = err as { type?: string; code?: string; message?: string };
  if (e?.type === 'entity.parse.failed') return errors.malformedJson();
  if (e?.type === 'entity.too.large') return errors.payloadTooLarge();
  if (e?.type === 'encoding.unsupported' || e?.type === 'charset.unsupported') return errors.unsupportedMediaType();
  if ((e?.code && DB_UNAVAILABLE.has(e.code)) || /timeout exceeded when trying to connect/i.test(e?.message ?? '')) {
    return errors.unavailable();
  }
  return undefined;
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  let apiError = toApiError(err);
  if (!apiError || apiError.status >= 500) {
    // Internal detail goes to the log only, never to the client.
    console.error(
      JSON.stringify({
        level: 'error',
        request_id: res.locals.requestId,
        method: req.method,
        path: req.path,
        error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      }),
    );
  }
  apiError ??= errors.internal();
  if (res.headersSent) return;
  res
    .status(apiError.status)
    .set(apiError.headers)
    .set('Cache-Control', 'no-store')
    .type('application/json')
    .send(JSON.stringify(apiError.toBody(String(res.locals.requestId ?? ''))));
};

export const routeNotFound: RequestHandler = (_req, _res, next) => next(errors.routeNotFound());
