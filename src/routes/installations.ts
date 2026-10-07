import { Router } from 'express';
import { z } from 'zod';
import { requireReader } from '../auth/middleware.js';
import { withSnapshot } from '../db/snapshot.js';
import type { AppDeps } from '../deps.js';
import { errors } from '../http/errors.js';
import { envelope } from '../http/pagination.js';
import { sendRepresentation } from '../http/respond.js';
import { paginationShape, parseQuery, uuidParam, uuidQuery } from '../http/validate.js';
import { assertConsistentGeography } from '../repositories/geography.js';
import { getInstallation, listInstallations } from '../repositories/installations.js';
import { getSubstation } from '../repositories/substations.js';
import { asyncHandler, readerScope, resource } from './route.js';

const listQuery = z.strictObject({
  'province-id': uuidQuery,
  'district-id': uuidQuery,
  'substation-id': uuidQuery,
  ...paginationShape,
});
const pageQuery = z.strictObject({ ...paginationShape });
const noQuery = z.strictObject({});

export function installationRoutes(deps: AppDeps): Router {
  const r = Router();

  resource(r, '/installations', {
    get: [
      requireReader,
      asyncHandler(async (req, res) => {
        const q = parseQuery(req, listQuery);
        const scope = readerScope(res);
        const filters = {
          provinceId: q['province-id'],
          districtId: q['district-id'],
          substationId: q['substation-id'],
        };
        const { data, count } = await withSnapshot(deps.db(), async (c) => {
          await assertConsistentGeography(c, scope, filters);
          return listInstallations(c, scope, filters, q);
        });
        sendRepresentation(
          req,
          res,
          envelope(req, data, count, q, {
            'province-id': q['province-id'],
            'district-id': q['district-id'],
            'substation-id': q['substation-id'],
          }),
        );
      }),
    ],
  });

  resource(r, '/installations/:installationId', {
    get: [
      requireReader,
      asyncHandler(async (req, res) => {
        const id = uuidParam(req, 'installationId');
        parseQuery(req, noQuery);
        const installation = await getInstallation(deps.db(), readerScope(res), id);
        if (!installation) throw errors.notFound('Installation');
        sendRepresentation(req, res, installation, { lastModified: installation.updated_at });
      }),
    ],
  });

  resource(r, '/grid-substations/:substationId/installations', {
    get: [
      requireReader,
      asyncHandler(async (req, res) => {
        const substationId = uuidParam(req, 'substationId');
        const q = parseQuery(req, pageQuery);
        const scope = readerScope(res);
        const result = await withSnapshot(deps.db(), async (c) => {
          if (!(await getSubstation(c, scope, substationId))) return undefined;
          return listInstallations(c, scope, { substationId }, q);
        });
        if (!result) throw errors.notFound('Grid substation');
        sendRepresentation(req, res, envelope(req, result.data, result.count, q));
      }),
    ],
  });

  return r;
}
