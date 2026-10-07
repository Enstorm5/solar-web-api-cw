import { Router } from 'express';
import { z } from 'zod';
import { requireReader } from '../auth/middleware.js';
import { withSnapshot } from '../db/snapshot.js';
import type { AppDeps } from '../deps.js';
import { ErrorCode, errors } from '../http/errors.js';
import { envelope } from '../http/pagination.js';
import { sendRepresentation } from '../http/respond.js';
import { paginationShape, parseQuery, uuidParam, uuidQuery } from '../http/validate.js';
import { getDistrict, listDistricts } from '../repositories/districts.js';
import { getProvince } from '../repositories/provinces.js';
import { districtObservations } from '../repositories/summary.js';
import { localDate, localDayBounds, summarise } from '../services/summary.js';
import { FUTURE_TOLERANCE_MS } from './readings.js';
import { asyncHandler, readerScope, resource } from './route.js';

const listQuery = z.strictObject({ 'province-id': uuidQuery, ...paginationShape });
const pageQuery = z.strictObject({ ...paginationShape });
const noQuery = z.strictObject({});
const summaryQuery = z.strictObject({
  date: z.iso.date('Must be a calendar date YYYY-MM-DD').optional(),
  'as-of': z.iso
    .datetime({
      offset: true,
      message: 'Must be an RFC 3339 date-time with a time zone (URL-encode "+" as %2B)',
    })
    .optional(),
});

export function districtRoutes(deps: AppDeps): Router {
  const r = Router();

  resource(r, '/districts', {
    get: [
      requireReader,
      asyncHandler(async (req, res) => {
        const q = parseQuery(req, listQuery);
        const scope = readerScope(res);
        const { data, count } = await withSnapshot(deps.db(), (c) =>
          listDistricts(c, scope, { provinceId: q['province-id'] }, q),
        );
        sendRepresentation(
          req,
          res,
          envelope(req, data, count, q, { 'province-id': q['province-id'] }),
        );
      }),
    ],
  });

  resource(r, '/districts/:districtId', {
    get: [
      requireReader,
      asyncHandler(async (req, res) => {
        const id = uuidParam(req, 'districtId');
        parseQuery(req, noQuery);
        const district = await getDistrict(deps.db(), readerScope(res), id);
        if (!district) throw errors.notFound('District');
        sendRepresentation(req, res, district);
      }),
    ],
  });

  // Derived aggregate (processing-style, named as a noun per the Q2 decision; see ARCHITECTURE AD-11).
  resource(r, '/districts/:districtId/generation-summary', {
    get: [
      requireReader,
      asyncHandler(async (req, res) => {
        const districtId = uuidParam(req, 'districtId');
        const q = parseQuery(req, summaryQuery);
        // Default evaluation bucket: the current minute, so repeated requests share an ETag.
        const asOf = q['as-of']
          ? new Date(q['as-of'])
          : new Date(Math.floor(Date.now() / 60_000) * 60_000);
        const date = q.date ?? localDate(asOf);
        const day = localDayBounds(date);
        const periodEnd = new Date(Math.min(asOf.getTime(), day.end.getTime()));
        const problems = [];
        if (asOf.getTime() > Date.now() + FUTURE_TOLERANCE_MS) {
          problems.push({
            code: ErrorCode.INVALID_QUERY,
            field: 'as-of',
            message: 'Must not be in the future',
          });
        }
        if (periodEnd.getTime() <= day.start.getTime()) {
          problems.push({
            code: ErrorCode.INVALID_QUERY,
            field: 'date',
            message: 'The day has not started at as-of',
          });
        }
        if (problems.length > 0) throw errors.invalidQuery(problems);

        const sites = await withSnapshot(deps.db(), async (c) => {
          if (!(await getDistrict(c, readerScope(res), districtId))) return undefined;
          return districtObservations(c, districtId, asOf, day.start, periodEnd);
        });
        if (!sites) throw errors.notFound('District');
        sendRepresentation(
          req,
          res,
          summarise({
            district_id: districtId,
            date,
            as_of: asOf,
            period_start: day.start,
            period_end: periodEnd,
            sites,
          }),
        );
      }),
    ],
  });

  // Scoped collection: the parent must be visible, otherwise 404 (not an empty list).
  resource(r, '/provinces/:provinceId/districts', {
    get: [
      requireReader,
      asyncHandler(async (req, res) => {
        const provinceId = uuidParam(req, 'provinceId');
        const q = parseQuery(req, pageQuery);
        const scope = readerScope(res);
        const result = await withSnapshot(deps.db(), async (c) => {
          if (!(await getProvince(c, scope, provinceId))) return undefined;
          return listDistricts(c, scope, { provinceId }, q);
        });
        if (!result) throw errors.notFound('Province');
        sendRepresentation(req, res, envelope(req, result.data, result.count, q));
      }),
    ],
  });

  return r;
}
