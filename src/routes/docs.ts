import express, { Router } from 'express';
import { loadSpec } from '../openapi/spec.js';

const DOCS_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SLSEA Solar Generation API</title>
  <link rel="stylesheet" href="/swagger-ui/vendor/swagger-ui.css">
  <link rel="icon" type="image/png" href="/swagger-ui/vendor/favicon-32x32.png">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="/swagger-ui/vendor/swagger-ui-bundle.js"></script>
  <script src="/swagger-ui/init.js"></script>
</body>
</html>`;

/** Public documentation surface. On Vercel the assets and /openapi.json come from public/. */
export function docsRoutes(): Router {
  const r = Router();
  // Local development only: Vercel ignores express.static and serves public/ from its CDN.
  r.use(express.static('public', { index: false }));
  r.get('/docs', (_req, res) => {
    res
      .set(
        'Content-Security-Policy',
        "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
      )
      .type('html')
      .send(DOCS_HTML);
  });
  let spec: string | undefined;
  r.get('/openapi.json', (_req, res) => {
    spec ??= JSON.stringify(loadSpec());
    res.type('application/json').send(spec);
  });
  return r;
}
