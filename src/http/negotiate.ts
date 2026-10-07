import type { RequestHandler } from 'express';
import { errors } from './errors.js';

interface MediaRange {
  type: string;
  subtype: string;
  q: number;
}

function parseAccept(header: string): MediaRange[] {
  const ranges: MediaRange[] = [];
  for (const part of header.split(',')) {
    const [media, ...params] = part.trim().split(';');
    const [type, subtype] = (media ?? '').trim().toLowerCase().split('/');
    if (!type || !subtype) continue;
    let q = 1;
    for (const p of params) {
      const [k, v] = p.trim().split('=');
      if (k?.trim().toLowerCase() === 'q') {
        const n = Number(v);
        q = Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0;
      }
    }
    ranges.push({ type, subtype, q });
  }
  return ranges;
}

/**
 * True when application/json is acceptable under RFC 9110 section 12.5.1: the most specific
 * matching media range decides the quality, and q=0 means "not acceptable".
 */
export function acceptsJson(header: string | undefined): boolean {
  if (header === undefined || header.trim() === '') return true;
  let best: { specificity: number; q: number } | undefined;
  for (const r of parseAccept(header)) {
    let specificity = -1;
    if (r.type === 'application' && r.subtype === 'json') specificity = 2;
    else if (r.type === 'application' && r.subtype === '*') specificity = 1;
    else if (r.type === '*' && r.subtype === '*') specificity = 0;
    if (specificity < 0) continue;
    if (!best || specificity > best.specificity) best = { specificity, q: r.q };
  }
  return best !== undefined && best.q > 0;
}

export const requireJsonAcceptable: RequestHandler = (req, _res, next) => {
  next(acceptsJson(req.get('accept')) ? undefined : errors.notAcceptable());
};
