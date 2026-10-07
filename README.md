# SLSEA Solar Generation API

Backend REST API (NB6007CEM coursework) for real-time and historical rooftop solar generation data for the Sri Lanka Sustainable Energy Authority. Installation devices push readings; SLSEA national, provincial and district users read data within their jurisdiction.

- Stack: Node.js 22, TypeScript, Express 5, PostgreSQL (Neon), deployed on Vercel.
- Base path: `/solar/v1.0`. Documentation: `/docs` (Swagger UI) and `/openapi.json`.

## Local development

```bash
npm ci
npm run dev          # http://localhost:3000
npm run typecheck
npm run lint
npm test             # unit tests
```

Configuration is read from environment variables; see `.env.example`. Never commit real values.
