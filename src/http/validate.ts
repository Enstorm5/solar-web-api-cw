import type { Request } from 'express';
import { z } from 'zod';
import { errors, type ErrorItem, ErrorCode } from './errors.js';

export function issuesToItems(error: z.ZodError, code: number): ErrorItem[] {
  return error.issues.map((i) => ({
    code,
    message: i.message,
    ...(i.path.length > 0 ? { field: i.path.join('.') } : {}),
  }));
}

/** Validates the query string against a strict schema: unknown or repeated parameters are 400. */
export function parseQuery<T extends z.ZodType>(req: Request, schema: T): z.infer<T> {
  const result = schema.safeParse(req.query);
  if (!result.success) throw errors.invalidQuery(issuesToItems(result.error, ErrorCode.INVALID_QUERY));
  return result.data;
}

export function parseBody<T extends z.ZodType>(req: Request, schema: T): z.infer<T> {
  const result = schema.safeParse(req.body);
  if (!result.success) throw errors.validation(issuesToItems(result.error, ErrorCode.VALIDATION_FAILED));
  return result.data;
}

const uuid = z.uuid();

/** Path identifiers are UUIDs; anything else is a 400 rather than a database round-trip. */
export function uuidParam(req: Request, name: string): string {
  const value = req.params[name];
  if (!uuid.safeParse(value).success) {
    throw errors.invalidPath([{ code: ErrorCode.INVALID_PATH_PARAMETER, message: 'Must be a UUID', field: name }]);
  }
  return (value as string).toLowerCase();
}

/** Integer query parameter given as a decimal string. */
export const intParam = (min: number, max: number, dflt: number) =>
  z
    .string()
    .regex(/^\d+$/, 'Must be a non-negative integer')
    .transform(Number)
    .pipe(z.number().int().min(min).max(max))
    .optional()
    .transform((v) => v ?? dflt);

export const uuidQuery = z.uuid('Must be a UUID').transform((s) => s.toLowerCase()).optional();

export const paginationShape = {
  limit: intParam(1, 100, 50),
  offset: intParam(0, 10_000_000, 0),
};
