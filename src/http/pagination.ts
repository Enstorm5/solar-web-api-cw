import type { Request } from 'express';

export interface Page {
  limit: number;
  offset: number;
}

export interface Envelope<T> {
  data: T[];
  count: number;
  limit: number;
  offset: number;
  next: string | null;
  previous: string | null;
}

/** Relative URI reference to the same collection with all active parameters preserved. */
function linkTo(req: Request, params: Record<string, string | number | undefined>, offset: number, limit: number): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && k !== 'limit' && k !== 'offset') qs.set(k, String(v));
  }
  qs.set('limit', String(limit));
  qs.set('offset', String(offset));
  return `${req.baseUrl}${req.path}?${qs.toString()}`;
}

/**
 * Builds the collection envelope (WSO2 section 10.3: count, next, previous). When the offset is
 * past the end, `previous` points at the last non-empty chunk so a client can recover.
 */
export function envelope<T>(
  req: Request,
  data: T[],
  count: number,
  page: Page,
  params: Record<string, string | number | undefined> = {},
): Envelope<T> {
  const { limit, offset } = page;
  const next = offset + limit < count ? linkTo(req, params, offset + limit, limit) : null;
  let previous: string | null = null;
  if (offset > 0) {
    const prevOffset = offset >= count ? Math.max(0, Math.ceil(count / limit) * limit - limit) : Math.max(0, offset - limit);
    previous = linkTo(req, params, prevOffset, limit);
  }
  return { data, count, limit, offset, next, previous };
}
