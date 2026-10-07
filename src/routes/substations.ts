import { Router } from 'express';
import { z } from 'zod';
import { requireReader } from '../auth/middleware.js';
import { withSnapshot } from '../db/snapshot.js';
import type { AppDeps } from '../deps.js';
import { errors } from '../http/errors.js';
import { envelope } from '../http/pagination.js';
import { sendRepresentation } from '../http/respond.js';
import { paginationShape, parseQuery, uuidParam, uuidQuery } from '../http/validate.js';
import { getDistrict } from '../repositories/districts.js';
import { assertConsistentGeography } from '../repositories/geography.js';
import { getSubstation, listSubstations } from '../repositories/substations.js';
import { asyncHandler, readerScope, resource } from './route.js';

const listQuery = z.strictObject({ 'province-id': uuidQuery, 'district-id': uuidQuery, ...paginationShape });
const pageQuery = z.strictObject({ ...paginationShape });
const noQuery = z.strictObject({});

export function substationRoutes(deps: AppDeps): Router {
  const r = Router();

  resource(r, '/grid-substations', {
    get: [
      requireReader,
      asyncHandler(async (req, res) => {
        const q = parseQuery(req, listQuery);
        const scope = readerScope(res);
        const filters = { provinceId: q['province-id'], districtId: q['district-id'] };
        const { data, count } = await withSnapshot(deps.db(), async (c) => {
          await assertConsistentGeography(c, scope, filters);
          return listSubstations(c, scope, filters, q);
        });
        sendRepresentation(
          req,
          res,
          envelope(req, data, count, q, { 'province-id': q['province-id'], 'district-id': q['district-id'] }),
        );
      }),
    ],
  });

  resource(r, '/grid-substations/:substationId', {
    get: [
      requireReader,
      asyncHandler(async (req, res) => {
        const id = uuidParam(req, 'substationId');
        parseQuery(req, noQuery);
        const substation = await getSubstation(deps.db(), readerScope(res), id);
        if (!substation) throw errors.notFound('Grid substation');
        sendRepresentation(req, res, substation);
      }),
    ],
  });

  resource(r, '/districts/:districtId/grid-substations', {
    get: [
      requireReader,
      asyncHandler(async (req, res) => {
        const districtId = uuidParam(req, 'districtId');
        const q = parseQuery(req, pageQuery);
        const scope = readerScope(res);
        const result = await withSnapshot(deps.db(), async (c) => {
          if (!(await getDistrict(c, scope, districtId))) return undefined;
          return listSubstations(c, scope, { districtId }, q);
        });
        if (!result) throw errors.notFound('District');
        sendRepresentation(req, res, envelope(req, result.data, result.count, q));
      }),
    ],
  });

  return r;
}
