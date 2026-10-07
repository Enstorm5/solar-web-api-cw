import { Router } from 'express';
import { z } from 'zod';
import { principalOf, requireDeviceWriter, requireReader } from '../auth/middleware.js';
import type { AppDeps } from '../deps.js';
import { ApiError, ErrorCode, errors } from '../http/errors.js';
import { jsonBody } from '../http/middleware.js';
import { sendRepresentation } from '../http/respond.js';
import { paginationShape, parseBody, parseQuery, uuidParam, uuidQuery } from '../http/validate.js';
import { withSnapshot } from '../db/snapshot.js';
import { envelope } from '../http/pagination.js';
import { assertConsistentGeography } from '../repositories/geography.js';
import { getInstallation } from '../repositories/installations.js';
import {
  DuplicateReadingError,
  getReading,
  insertReading,
  listReadings,
} from '../repositories/readings.js';
import { asyncHandler, readerScope, resource } from './route.js';

/** Devices may report slightly ahead of server time; anything further is a clock fault. */
export const FUTURE_TOLERANCE_MS = 5 * 60_000;
const EARLIEST = Date.parse('2000-01-01T00:00:00Z');

const finite = (min: number, max: number) => z.number().min(min).max(max);

const readingCreate = z.strictObject({
  timestamp: z.iso
    .datetime({ offset: true, message: 'Must be an RFC 3339 date-time with a time zone' })
    .transform((s) => new Date(s))
    .refine((d) => d.getTime() >= EARLIEST, 'Must not be before 2000-01-01')
    .refine(
      (d) => d.getTime() <= Date.now() + FUTURE_TOLERANCE_MS,
      'Must not be more than 5 minutes in the future',
    ),
  power_kw: finite(0, 100_000),
  cumulative_energy_kwh: finite(0, 99_999_999_999),
  voltage_v: finite(0, 1000),
});

const noQuery = z.strictObject({});

const instant = z.iso.datetime({
  offset: true,
  message: 'Must be an RFC 3339 date-time with a time zone (URL-encode "+" as %2B)',
});
const historyShape = {
  from: instant.optional(),
  to: instant.optional(),
  sort: z.enum(['timestamp', '-timestamp']).optional(),
  ...paginationShape,
};
const timeWindowValid = (q: { from?: string | undefined; to?: string | undefined }) =>
  !q.from || !q.to || Date.parse(q.to) > Date.parse(q.from);
const windowRule = { message: '`to` must be later than `from`', path: ['to'] };
const historyQuery = z.strictObject(historyShape).refine(timeWindowValid, windowRule);
const regionalQuery = z
  .strictObject({
    'province-id': uuidQuery,
    'district-id': uuidQuery,
    'substation-id': uuidQuery,
    ...historyShape,
  })
  .refine(timeWindowValid, windowRule);

const toDate = (s: string | undefined) => (s ? new Date(s) : undefined);

export const readingUri = (installationId: string, readingId: string) =>
  `/solar/v1.0/installations/${installationId}/readings/${readingId}`;

export function readingRoutes(deps: AppDeps): Router {
  const r = Router();

  resource(r, '/installations/:installationId/readings', {
    get: [
      requireReader,
      asyncHandler(async (req, res) => {
        const installationId = uuidParam(req, 'installationId');
        const q = parseQuery(req, historyQuery);
        const scope = readerScope(res);
        const sort = q.sort ?? '-timestamp';
        const result = await withSnapshot(deps.db(), async (c) => {
          if (!(await getInstallation(c, scope, installationId))) return undefined;
          return listReadings(
            c,
            scope,
            {
              installationId,
              from: toDate(q.from),
              to: toDate(q.to),
              ascending: sort === 'timestamp',
            },
            q,
          );
        });
        if (!result) throw errors.notFound('Installation');
        sendRepresentation(
          req,
          res,
          envelope(req, result.data, result.count, q, { from: q.from, to: q.to, sort }),
        );
      }),
    ],
    post: [
      requireDeviceWriter,
      (req, res, next) => {
        // The token, not the URI, decides which installation a device may write for.
        const p = principalOf(res);
        const bound =
          p.kind === 'device' &&
          p.installationId === String(req.params.installationId).toLowerCase();
        next(
          bound
            ? undefined
            : new ApiError(
                403,
                ErrorCode.INSUFFICIENT_SCOPE,
                'Device token is bound to a different installation',
              ),
        );
      },
      ...jsonBody,
      asyncHandler(async (req, res) => {
        const installationId = uuidParam(req, 'installationId');
        parseQuery(req, noQuery);
        const body = parseBody(req, readingCreate);
        let reading;
        try {
          reading = await insertReading(deps.db(), installationId, body);
        } catch (err) {
          if (err instanceof DuplicateReadingError) {
            throw new ApiError(
              409,
              ErrorCode.DUPLICATE_READING,
              'A reading for this installation and timestamp already exists; history is never overwritten',
            );
          }
          throw err;
        }
        const location = readingUri(installationId, reading.id);
        sendRepresentation(req, res, reading, {
          status: 201,
          lastModified: reading.received_at,
          headers: { Location: location, 'Content-Location': location },
        });
      }),
    ],
  });

  resource(r, '/readings', {
    get: [
      requireReader,
      asyncHandler(async (req, res) => {
        const q = parseQuery(req, regionalQuery);
        const scope = readerScope(res);
        const sort = q.sort ?? '-timestamp';
        const geo = {
          provinceId: q['province-id'],
          districtId: q['district-id'],
          substationId: q['substation-id'],
        };
        const { data, count } = await withSnapshot(deps.db(), async (c) => {
          await assertConsistentGeography(c, scope, geo);
          return listReadings(
            c,
            scope,
            { ...geo, from: toDate(q.from), to: toDate(q.to), ascending: sort === 'timestamp' },
            q,
          );
        });
        sendRepresentation(
          req,
          res,
          envelope(req, data, count, q, {
            'province-id': q['province-id'],
            'district-id': q['district-id'],
            'substation-id': q['substation-id'],
            from: q.from,
            to: q.to,
            sort,
          }),
        );
      }),
    ],
  });

  resource(r, '/installations/:installationId/readings/:readingId', {
    get: [
      requireReader,
      asyncHandler(async (req, res) => {
        const installationId = uuidParam(req, 'installationId');
        const readingId = uuidParam(req, 'readingId');
        parseQuery(req, noQuery);
        const reading = await getReading(deps.db(), readerScope(res), installationId, readingId);
        if (!reading) throw errors.notFound('Reading');
        sendRepresentation(req, res, reading, { lastModified: reading.received_at });
      }),
    ],
  });

  return r;
}
