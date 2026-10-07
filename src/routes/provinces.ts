import { Router } from 'express';
import { z } from 'zod';
import { principalOf, requireReader } from '../auth/middleware.js';
import type { Principal } from '../auth/principal.js';
import { withSnapshot } from '../db/snapshot.js';
import type { AppDeps } from '../deps.js';
import { errors } from '../http/errors.js';
import { envelope } from '../http/pagination.js';
import { sendRepresentation } from '../http/respond.js';
import { paginationShape, parseQuery, uuidParam } from '../http/validate.js';
import { getProvince, listProvinces } from '../repositories/provinces.js';
import { scopeParams } from '../repositories/scope.js';
import { asyncHandler, resource } from './route.js';

const listQuery = z.strictObject({ ...paginationShape });
const noQuery = z.strictObject({});

export const readerScope = (p: Principal) => {
  if (p.kind !== 'reader') throw new Error('reader principal expected');
  return scopeParams(p.jurisdiction);
};

export function provinceRoutes(deps: AppDeps): Router {
  const r = Router();

  resource(r, '/provinces', {
    get: [
      requireReader,
      asyncHandler(async (req, res) => {
        const q = parseQuery(req, listQuery);
        const scope = readerScope(principalOf(res));
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
        const province = await getProvince(deps.db(), readerScope(principalOf(res)), id);
        if (!province) throw errors.notFound('Province');
        sendRepresentation(req, res, province);
      }),
    ],
  });

  return r;
}
