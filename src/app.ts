// Vercel entrypoint: zero-config Express requires this file to import express and default-export
// the app. Configuration lives in create-app.ts so tests can inject dependencies.
import express from 'express';
import { createApp } from './create-app.js';
import { envDeps } from './deps.js';

export default createApp(envDeps(), express());
