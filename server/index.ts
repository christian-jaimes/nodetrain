import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from './app';
import { ProviderManager } from './providers/manager';

// Secrets come from the environment or a local .env file that git ignores.
if (existsSync('.env')) {
  try {
    process.loadEnvFile('.env');
  } catch (err) {
    console.error(`Couldn't read .env (${err instanceof Error ? err.message : err}). Save it as plain UTF-8 text with lines like OPENAI_API_KEY=sk-...`);
  }
}

const PORT = Number(process.env.NODETRAIN_PORT ?? 8787);
// Local only: the server is never reachable from other machines.
const HOST = '127.0.0.1';
const dataDir = resolve(process.env.NODETRAIN_DATA_DIR ?? 'data');

const { app, close, providers } = createApp({
  dataDir,
  providers: (dir) =>
    new ProviderManager({
      dataDir: dir,
      envKey: process.env.OPENAI_API_KEY?.trim() || undefined,
      baseUrl: process.env.OPENAI_BASE_URL,
      forceSimulated: process.env.NODETRAIN_PROVIDER === 'simulated',
    }),
});

// In production (`npm start`) the server also hosts the built app.
const dist = resolve('dist');
if (existsSync(dist)) {
  app.use('/*', serveStatic({ root: 'dist' }));
  app.get('*', serveStatic({ path: 'dist/index.html' }));
}

const server = serve({ fetch: app.fetch, port: PORT, hostname: HOST }, (info) => {
  console.log(`NodeTrain server on http://${HOST}:${info.port}  (data: ${dataDir})`);
  const st = providers.status();
  console.log(
    st.provider.id === 'openai'
      ? `Image provider: OpenAI, key ${st.key?.hint} from ${st.key?.source === 'app' ? 'Account settings' : '.env'} (never sent to the browser).`
      : st.forcedSimulated
        ? 'Image provider: simulated, because NODETRAIN_PROVIDER=simulated is set.'
        : 'Image provider: simulated. Add your OpenAI API key in Account settings (bottom of the left sidebar) or in .env.',
  );
});

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use, probably by another NodeTrain server that is still running. Close that terminal (or end the node process in Task Manager) and run npm run dev again.`);
    process.exit(1);
  }
  throw err;
});

const shutdown = () => {
  server.close();
  close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
