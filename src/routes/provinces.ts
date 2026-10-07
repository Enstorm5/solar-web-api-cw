import { Router } from 'express';
import { z } from 'zod';
import { requireReader } from '../auth/middleware.js';
import { withSnapshot } from '../db/snapshot.js';
import type { AppDeps } from '../deps.js';
import { errors } from '../http/errors.js';
import { envelope } from '../http/pagination.js';
import { sendRepresentation } from '../http/respond.js';
import { paginationShape, parseQuery, uuidParam } from '../http/validate.js';
import { getProvince, listProvinces } from '../repositories/provinces.js';
import { asyncHandler, readerScope, resource } from './route.js';

const listQuery = z.strictObject({ ...paginationShape });
const noQuery = z.strictObject({});

export function provinceRoutes(deps: AppDeps): Router {
  const r = Router();

  resource(r, '/provinces', {
    get: [
      requireReader,
      asyncHandler(async (req, res) => {
        const q = parseQuery(req, listQuery);
        const scope = readerScope(res);
        const { data, count } = await withSnapshot(deps.db(), (c) => listProvinces(c, scope, q));
        sendRepresentation(req, res, envelope(req, data, count, q));
      }),
    ],
  });

  resource(r, '/provinces/:provinceId', {
    get: [
      requireReader,
      asyncHandler(async (req, res) => {
        const id = uuidParam(req, 'provinceId');
        parseQuery(req, noQuery);
        const province = await getProvince(deps.db(), readerScope(res), id);
        if (!province) throw errors.notFound('Province');
        sendRepresentation(req, res, province);
      }),
    ],
  });

  return r;
}
