import { Router } from 'express';
import { z } from 'zod';
import { requireManager, requireReader, requireReaderOrManager } from '../auth/middleware.js';
import { withSnapshot } from '../db/snapshot.js';
import type { AppDeps } from '../deps.js';
import { ErrorCode, errors } from '../http/errors.js';
import { jsonBody } from '../http/middleware.js';
import { envelope } from '../http/pagination.js';
import { sendRepresentation } from '../http/respond.js';
import { paginationShape, parseBody, parseQuery, uuidParam, uuidQuery } from '../http/validate.js';
import {
  createInstallation,
  deleteInstallation,
  replaceInstallation,
  type AdminOutcome,
} from '../repositories/installation-admin.js';
import { assertConsistentGeography } from '../repositories/geography.js';
import { getInstallation, listInstallations } from '../repositories/installations.js';
import { getOverview } from '../repositories/overview.js';
import { latestReading } from '../repositories/readings.js';
import { getSubstation } from '../repositories/substations.js';
import { readingUri } from './readings.js';
import { asyncHandler, readerScope, resource } from './route.js';

const listQuery = z.strictObject({
  'province-id': uuidQuery,
  'district-id': uuidQuery,
  'substation-id': uuidQuery,
  ...paginationShape,
});
const pageQuery = z.strictObject({ ...paginationShape });
const noQuery = z.strictObject({});

const isoDate = z.iso
  .date('Must be a calendar date YYYY-MM-DD')
  .refine(
    (d) => Date.parse(`${d}T00:00:00Z`) <= Date.now() + 86_400_000,
    'Must not be in the future',
  );
const editable = {
  meter_id: z
    .string()
    .regex(/^[A-Z0-9][A-Z0-9-]{0,39}$/, 'Uppercase letters, digits and hyphens (max 40)'),
  label: z.string().trim().min(1).max(120),
  capacity_kw: z.number().positive().max(999_999),
  commissioned_on: isoDate,
  active: z.boolean(),
};
/** POST: the parent substation comes from the URI, never the body. */
const installationCreate = z.strictObject(editable);
/** PUT: the complete editable representation; server-managed fields are not accepted. */
const installationReplace = z.strictObject({
  substation_id: z.uuid().transform((s) => s.toLowerCase()),
  ...editable,
});

const installationUri = (id: string) => `/solar/v1.0/installations/${id}`;

function requireIfMatch(header: string | undefined): string {
  if (!header) throw errors.preconditionRequired();
  return header;
}

function unwrap<T>(o: AdminOutcome<T>): T {
  switch (o.kind) {
    case 'ok':
      return o.value;
    case 'not-found':
      throw errors.notFound('Installation');
    case 'precondition-failed':
      throw errors.preconditionFailed();
    case 'unknown-substation':
      throw errors.validation([
        {
          code: ErrorCode.VALIDATION_FAILED,
          field: 'substation_id',
          message: 'Unknown grid substation',
        },
      ]);
    case 'duplicate-meter':
      throw errors.conflict(
        ErrorCode.DUPLICATE_METER,
        'Another installation already uses this meter_id',
      );
    case 'history-protected':
      throw errors.conflict(
        ErrorCode.HISTORY_PROTECTED,
        `Cannot change ${o.fields.join(', ')} of an installation that has recorded readings`,
      );
    case 'has-readings':
      throw errors.conflict(
        ErrorCode.INSTALLATION_HAS_READINGS,
        'Installations with recorded readings cannot be deleted; deactivate instead',
      );
  }
}

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
      requireReaderOrManager,
      asyncHandler(async (req, res) => {
        const id = uuidParam(req, 'installationId');
        parseQuery(req, noQuery);
        const installation = await getInstallation(deps.db(), readerScope(res), id);
        if (!installation) throw errors.notFound('Installation');
        sendRepresentation(req, res, installation, { lastModified: installation.updated_at });
      }),
    ],
    put: [
      requireManager,
      ...jsonBody,
      asyncHandler(async (req, res) => {
        const id = uuidParam(req, 'installationId');
        parseQuery(req, noQuery);
        const ifMatch = requireIfMatch(req.get('if-match'));
        const body = parseBody(req, installationReplace);
        const updated = unwrap(await replaceInstallation(deps.db(), id, ifMatch, body));
        sendRepresentation(req, res, updated, { lastModified: updated.updated_at });
      }),
    ],
    delete: [
      requireManager,
      asyncHandler(async (req, res) => {
        const id = uuidParam(req, 'installationId');
        parseQuery(req, noQuery);
        const ifMatch = requireIfMatch(req.get('if-match'));
        const deleted = unwrap(await deleteInstallation(deps.db(), id, ifMatch));
        res.set('Cache-Control', 'no-store').status(200).json({ id: deleted.id, deleted: true });
      }),
    ],
  });

  resource(r, '/installations/:installationId/overview', {
    get: [
      requireReader,
      asyncHandler(async (req, res) => {
        const id = uuidParam(req, 'installationId');
        parseQuery(req, noQuery);
        const overview = await withSnapshot(deps.db(), (c) => getOverview(c, readerScope(res), id));
        if (!overview) throw errors.notFound('Installation');
        // ETag only: the composite depends on several rows, so no single reliable Last-Modified.
        sendRepresentation(req, res, overview);
      }),
    ],
  });

  // Derived operational resource: the newest observation, not a stored "last value" field.
  resource(r, '/installations/:installationId/last-known-reading', {
    get: [
      requireReader,
      asyncHandler(async (req, res) => {
        const id = uuidParam(req, 'installationId');
        parseQuery(req, noQuery);
        const scope = readerScope(res);
        const result = await withSnapshot(deps.db(), async (c) => {
          if (!(await getInstallation(c, scope, id))) return { installation: false as const };
          return { installation: true as const, reading: await latestReading(c, id) };
        });
        if (!result.installation) throw errors.notFound('Installation');
        if (!result.reading) throw errors.notFound('Reading (installation has not reported yet)');
        const uri = readingUri(id, result.reading.id);
        sendRepresentation(
          req,
          res,
          { ...result.reading, reading_uri: uri },
          { headers: { 'Content-Location': uri } },
        );
      }),
    ],
  });

  resource(r, '/grid-substations/:substationId/installations', {
    post: [
      requireManager,
      ...jsonBody,
      asyncHandler(async (req, res) => {
        const substationId = uuidParam(req, 'substationId');
        parseQuery(req, noQuery);
        const body = parseBody(req, installationCreate);
        const outcome = await createInstallation(deps.db(), {
          substation_id: substationId,
          ...body,
        });
        if (outcome.kind === 'unknown-substation') throw errors.notFound('Grid substation');
        const created = unwrap(outcome);
        const uri = installationUri(created.id);
        sendRepresentation(req, res, created, {
          status: 201,
          lastModified: created.updated_at,
          headers: { Location: uri, 'Content-Location': uri },
        });
      }),
    ],
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
