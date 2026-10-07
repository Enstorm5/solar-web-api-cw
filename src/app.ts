import express from 'express';

const app = express();
app.disable('x-powered-by');

app.get('/health/live', (_req, res) => {
  res.json({ status: 'ok' });
});

export default app;
