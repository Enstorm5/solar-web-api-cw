// Vercel entrypoint: the Express app is the default export (zero-config Express on Vercel).
import { createApp } from './create-app.js';
import { envDeps } from './deps.js';

export default createApp(envDeps());
