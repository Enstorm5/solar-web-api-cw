import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';

export function etagFor(json: string): string {
  return `"${createHash('sha256').update(json).digest('base64url')}"`;
}

/** Weak comparison (RFC 9110 section 8.8.3.2) against an If-None-Match list. */
export function ifNoneMatchMatches(header: string, etag: string): boolean {
  if (header.trim() === '*') return true;
  const opaque = (t: string) => t.trim().replace(/^W\//, '');
  return header.split(',').some((t) => opaque(t) === opaque(etag));
}

function notModifiedSince(header: string, lastModified: Date): boolean {
  const since = Date.parse(header);
  if (Number.isNaN(since)) return false;
  // HTTP-dates have one-second resolution.
  return Math.floor(lastModified.getTime() / 1000) * 1000 <= since;
}

export interface RepresentationOptions {
  status?: number;
  lastModified?: Date;
  headers?: Record<string, string>;
}

/**
 * Sends a JSON representation with validators. For GET, evaluates If-None-Match (precedence)
 * and If-Modified-Since, answering 304 with an empty body when the client copy is current.
 * Callers must have authenticated and authorised the request before calling this.
 */
export function sendRepresentation(
  req: Request,
  res: Response,
  body: unknown,
  opts: RepresentationOptions = {},
): void {
  const json = JSON.stringify(body);
  const etag = etagFor(json);
  res.set({
    ETag: etag,
    'Cache-Control': 'private, no-cache',
    Vary: 'Authorization, Accept',
    ...opts.headers,
  });
  if (opts.lastModified) res.set('Last-Modified', opts.lastModified.toUTCString());

  const status = opts.status ?? 200;
  if (status === 200 && (req.method === 'GET' || req.method === 'HEAD')) {
    const inm = req.get('if-none-match');
    const ims = req.get('if-modified-since');
    const fresh =
      inm !== undefined
        ? ifNoneMatchMatches(inm, etag)
        : ims !== undefined && opts.lastModified !== undefined && notModifiedSince(ims, opts.lastModified);
    if (fresh) {
      res.status(304).end();
      return;
    }
  }
  res.status(status).type('application/json').send(json);
}
