import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OpenAIProvider } from '../server/providers/openai';
import { ProviderError, type ImageGenerationRequest } from '../server/providers/types';

const PNG = Buffer.from('iVBORw0KGgo=', 'base64');

type Call = { url: string; init: RequestInit };

function mockFetch(responses: (() => Response)[]) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = responses.shift();
    if (!next) throw new Error('no more responses');
    return next();
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const ok = (usage?: object) => () =>
  new Response(JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }], output_format: 'png', usage }), { status: 200, headers: { 'content-type': 'application/json' } });
const fail = (status: number, code: string, message = 'nope') => () =>
  new Response(JSON.stringify({ error: { message, code } }), { status, headers: { 'x-request-id': 'req_123' } });

const req = (patch: Partial<ImageGenerationRequest> = {}): ImageGenerationRequest => ({
  prompt: 'a red bottle',
  references: [],
  model: 'gpt-image-2',
  aspectRatio: '16:9',
  quality: 'High',
  signal: new AbortController().signal,
  ...patch,
});

const provider = (fetchFn: typeof fetch) => new OpenAIProvider({ apiKey: 'sk-test', fetch: fetchFn, retryDelayMs: 1 });

describe('OpenAIProvider', () => {
  it('sends prompt-only requests as JSON to images/generations', async () => {
    const { fn, calls } = mockFetch([ok({ input_tokens: 10, output_tokens: 200, total_tokens: 210, input_tokens_details: { text_tokens: 10, image_tokens: 0 } })]);
    const res = await provider(fn).generateImage(req());
    expect(calls[0].url).toBe('https://api.openai.com/v1/images/generations');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({ model: 'gpt-image-2', prompt: 'a red bottle', size: '1536x864', quality: 'high', n: 1 });
    expect(res.images[0].data.equals(PNG)).toBe(true);
    expect(res.usage).toEqual({ inputTokens: 10, outputTokens: 200, totalTokens: 210, inputTextTokens: 10, inputImageTokens: 0 });
  });

  it('sends reference images as multipart to images/edits', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nt-openai-'));
    const refs = ['a', 'b'].map((id) => {
      const path = join(dir, `${id}.png`);
      writeFileSync(path, PNG);
      return { id, path, mime: 'image/png', width: 1, height: 1 };
    });
    const { fn, calls } = mockFetch([ok()]);
    const res = await provider(fn).generateImage(req({ references: refs, aspectRatio: '1:1', quality: 'Default' }));
    expect(calls[0].url).toMatch(/\/images\/edits$/);
    const form = calls[0].init.body as FormData;
    expect(form.getAll('image[]')).toHaveLength(2);
    expect(form.get('size')).toBe('1024x1024');
    expect(form.get('quality')).toBe('auto');
    expect(res.usage).toBeUndefined();
  });

  it('refuses settings the model cannot honour without calling the API', async () => {
    const { fn, calls } = mockFetch([]);
    await expect(provider(fn).generateImage(req({ model: 'gpt-image-1.5' }))).rejects.toMatchObject({ category: 'unsupported' });
    expect(calls).toHaveLength(0);
  });

  it.each([
    [401, 'invalid_api_key', 'auth'],
    [429, 'insufficient_quota', 'quota'],
    [400, 'moderation_blocked', 'safety'],
    [404, 'model_not_found', 'unsupported'],
    [400, 'invalid_value', 'invalid_input'],
  ])('classifies %i %s as %s without retrying', async (status, code, category) => {
    const { fn, calls } = mockFetch([fail(status, code), ok()]);
    const err = (await provider(fn).generateImage(req()).catch((e) => e)) as ProviderError;
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.category).toBe(category);
    expect(err.message).toContain('req_123');
    expect(err.message).not.toContain('sk-test');
    expect(calls).toHaveLength(1);
  });

  it('retries rate limits and server errors, then succeeds', async () => {
    const { fn, calls } = mockFetch([fail(429, 'rate_limit_exceeded'), fail(503, 'server_error'), ok()]);
    const res = await provider(fn).generateImage(req());
    expect(res.images).toHaveLength(1);
    expect(calls).toHaveLength(3);
  });

  it('gives up after the retry limit', async () => {
    const { fn, calls } = mockFetch([fail(500, ''), fail(500, ''), fail(500, ''), ok()]);
    await expect(provider(fn).generateImage(req())).rejects.toMatchObject({ category: 'outage' });
    expect(calls).toHaveLength(3);
  });

  it('reports cancel as canceled, not as a network error', async () => {
    const ac = new AbortController();
    const fn = ((_u: string, init: RequestInit) =>
      new Promise((_r, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))) as unknown as typeof fetch;
    const p = provider(fn).generateImage(req({ signal: ac.signal }));
    ac.abort();
    await expect(p).rejects.toMatchObject({ category: 'canceled' });
  });
});
