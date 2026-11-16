import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProviderStatus } from '../shared/api';
import { createApp } from '../server/app';
import { ProviderManager } from '../server/providers/manager';

const GOOD = 'sk-test-good-0000000000000000abcd';
const BAD = 'sk-test-bad-00000000000000000wxyz';

// Fake OpenAI: accepts GOOD on /models, rejects everything else.
const fakeFetch = (async (_url: string, init: RequestInit) => {
  const auth = (init.headers as Record<string, string>).Authorization;
  return auth === `Bearer ${GOOD}` ? new Response('{"data":[]}', { status: 200 }) : new Response('{"error":{"message":"bad key"}}', { status: 401 });
}) as unknown as typeof fetch;

let dir: string;
let ctx: ReturnType<typeof createApp>;

const make = (envKey?: string) => {
  ctx = createApp({ dataDir: dir, providers: (d) => new ProviderManager({ dataDir: d, envKey, fetch: fakeFetch }) });
  return ctx;
};
const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = { 'x-nodetrain-client': '1' }) =>
  ctx.app.request(path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nodetrain-settings-'));
});
afterEach(() => {
  ctx?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('account settings', () => {
  it('starts simulated without a key', async () => {
    make();
    const s = (await (await call('GET', '/api/settings')).json()) as ProviderStatus;
    expect(s).toMatchObject({ provider: { id: 'simulated' }, key: null, envKeyPresent: false });
  });

  it('checks, saves and uses a key, and never returns it', async () => {
    make();
    const res = await call('PUT', '/api/settings/keys/openai', { apiKey: `  ${GOOD}  ` });
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain(GOOD);
    expect(JSON.parse(text)).toMatchObject({ provider: { id: 'openai' }, key: { source: 'app', hint: 'sk-…abcd' } });
    expect(JSON.parse(readFileSync(join(dir, 'secrets.json'), 'utf8')).openaiApiKey).toBe(GOOD);
    const health = await (await call('GET', '/api/health')).text();
    expect(health).toContain('"openai"');
    expect(health).not.toContain(GOOD);

    // Survives a restart.
    ctx.close();
    make();
    expect(((await (await call('GET', '/api/settings')).json()) as ProviderStatus).provider.id).toBe('openai');
  });

  it('rejects a key OpenAI refuses, without saving it', async () => {
    make();
    const res = await call('PUT', '/api/settings/keys/openai', { apiKey: BAD });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/rejected this key/);
    expect(existsSync(join(dir, 'secrets.json'))).toBe(false);
    expect((await call('PUT', '/api/settings/keys/openai', { apiKey: 'not a key' })).status).toBe(400);
  });

  it('prefers a saved key over .env and falls back when it is removed', async () => {
    make('sk-from-env-000000000000000000env1');
    expect(((await (await call('GET', '/api/settings')).json()) as ProviderStatus).key).toMatchObject({ source: 'env', hint: 'sk-…env1' });
    await call('PUT', '/api/settings/keys/openai', { apiKey: GOOD });
    const removed = (await (await call('DELETE', '/api/settings/keys/openai')).json()) as ProviderStatus;
    expect(removed).toMatchObject({ provider: { id: 'openai' }, key: { source: 'env' } });
    expect(existsSync(join(dir, 'secrets.json'))).toBe(false);
  });

  it('refuses key changes from other sites', async () => {
    make();
    expect((await call('PUT', '/api/settings/keys/openai', { apiKey: GOOD }, {})).status).toBe(403);
    expect((await call('PUT', '/api/settings/keys/openai', { apiKey: GOOD }, { 'x-nodetrain-client': '1', origin: 'https://evil.example' })).status).toBe(403);
    expect((await call('GET', '/api/settings', undefined, { host: 'evil.example' })).status).toBe(403);
    expect((await call('GET', '/api/settings', undefined, { origin: 'http://localhost:5173' })).status).toBe(200);
  });
});
