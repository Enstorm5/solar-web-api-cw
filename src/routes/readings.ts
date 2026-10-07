import { Router } from 'express';
import { z } from 'zod';
import { principalOf, requireDeviceWriter, requireReader } from '../auth/middleware.js';
import type { AppDeps } from '../deps.js';
import { ApiError, ErrorCode, errors } from '../http/errors.js';
import { jsonBody } from '../http/middleware.js';
import { sendRepresentation } from '../http/respond.js';
import { parseBody, parseQuery, uuidParam } from '../http/validate.js';
import { DuplicateReadingError, getReading, insertReading } from '../repositories/readings.js';
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

export const readingUri = (installationId: string, readingId: string) =>
  `/solar/v1.0/installations/${installationId}/readings/${readingId}`;

export function readingRoutes(deps: AppDeps): Router {
  const r = Router();

  resource(r, '/installations/:installationId/readings', {
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
