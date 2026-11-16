import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from './app';

const PORT = Number(process.env.NODETRAIN_PORT ?? 8787);
// Local only: the server is never reachable from other machines.
const HOST = '127.0.0.1';
const dataDir = resolve(process.env.NODETRAIN_DATA_DIR ?? 'data');

const { app, close } = createApp({ dataDir });

// In production (`npm start`) the server also hosts the built app.
const dist = resolve('dist');
if (existsSync(dist)) {
  app.use('/*', serveStatic({ root: 'dist' }));
  app.get('*', serveStatic({ path: 'dist/index.html' }));
}

const server = serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
  console.log(`NodeTrain server on http://${HOST}:${info.port}  (data: ${dataDir})`);
});

const shutdown = () => {
  server.close();
  close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
