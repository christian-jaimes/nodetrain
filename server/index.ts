import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from './app';
import { OpenAIProvider } from './providers/openai';
import { SimulatedProvider } from './providers/simulated';

// Secrets come from the environment or a local .env file that git ignores.
if (existsSync('.env')) process.loadEnvFile('.env');

const PORT = Number(process.env.NODETRAIN_PORT ?? 8787);
// Local only: the server is never reachable from other machines.
const HOST = '127.0.0.1';
const dataDir = resolve(process.env.NODETRAIN_DATA_DIR ?? 'data');

const apiKey = process.env.OPENAI_API_KEY?.trim();
const forceSimulated = process.env.NODETRAIN_PROVIDER === 'simulated';
const provider = apiKey && !forceSimulated ? new OpenAIProvider({ apiKey, baseUrl: process.env.OPENAI_BASE_URL }) : new SimulatedProvider();

const { app, close } = createApp({ dataDir, provider });

// In production (`npm start`) the server also hosts the built app.
const dist = resolve('dist');
if (existsSync(dist)) {
  app.use('/*', serveStatic({ root: 'dist' }));
  app.get('*', serveStatic({ path: 'dist/index.html' }));
}

const server = serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
  console.log(`NodeTrain server on http://${HOST}:${info.port}  (data: ${dataDir})`);
  console.log(
    provider.id === 'openai'
      ? 'Image provider: OpenAI (key loaded from the environment; it is never sent to the browser).'
      : 'Image provider: simulated. Add OPENAI_API_KEY to a .env file to generate real images.',
  );
});

const shutdown = () => {
  server.close();
  close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
