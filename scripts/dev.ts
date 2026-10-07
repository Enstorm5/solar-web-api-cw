// Local development entrypoint. Vercel imports src/app.ts directly and never runs this file.
import app from '../src/app.js';

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
