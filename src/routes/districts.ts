import { Router } from 'express';
import { z } from 'zod';
import { requireReader } from '../auth/middleware.js';
import { withSnapshot } from '../db/snapshot.js';
import type { AppDeps } from '../deps.js';
import { errors } from '../http/errors.js';
import { envelope } from '../http/pagination.js';
import { sendRepresentation } from '../http/respond.js';
import { paginationShape, parseQuery, uuidParam, uuidQuery } from '../http/validate.js';
import { getDistrict, listDistricts } from '../repositories/districts.js';
import { getProvince } from '../repositories/provinces.js';
import { asyncHandler, readerScope, resource } from './route.js';

const listQuery = z.strictObject({ 'province-id': uuidQuery, ...paginationShape });
const pageQuery = z.strictObject({ ...paginationShape });
const noQuery = z.strictObject({});

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
        sendRepresentation(req, res, envelope(req, data, count, q, { 'province-id': q['province-id'] }));
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
