import { readFile } from 'node:fs/promises';
import { ALL_QUALITIES, ASPECT_RATIOS, IMAGE_MODEL_LIST, apiQuality, apiSize, getModel } from '../../shared/graph/models';
import { ProviderError, type ErrorCategory, type ImageGenerationRequest, type ImageGenerationResult, type ImageProvider } from './types';

type FetchLike = typeof fetch;

export type OpenAIOptions = {
  apiKey: string;
  baseUrl?: string;
  /** Injected in tests. */
  fetch?: FetchLike;
  /** Per-attempt timeout. Image generation can take a minute or more. */
  timeoutMs?: number;
  /** Retries for transient failures (network, 5xx, rate limits). */
  maxRetries?: number;
  retryDelayMs?: number;
};

type OpenAIImageResponse = {
  data?: { b64_json?: string }[];
  output_format?: string;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number; input_tokens_details?: { text_tokens?: number; image_tokens?: number } };
};

type OpenAIErrorBody = { error?: { message?: string; code?: string | null; type?: string } };

const MIME: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };

function classify(status: number, body: OpenAIErrorBody): { category: ErrorCategory; retryable: boolean } {
  const code = body.error?.code ?? body.error?.type ?? '';
  if (status === 401 || status === 403) return { category: 'auth', retryable: false };
  if (code === 'insufficient_quota' || code === 'billing_hard_limit_reached') return { category: 'quota', retryable: false };
  if (status === 429) return { category: 'quota', retryable: true };
  if (/moderation|content_policy|safety/i.test(code)) return { category: 'safety', retryable: false };
  if (status === 404 || code === 'model_not_found') return { category: 'unsupported', retryable: false };
  if (status >= 500) return { category: 'outage', retryable: true };
  return { category: 'invalid_input', retryable: false };
}

const FRIENDLY: Partial<Record<ErrorCategory, string>> = {
  auth: 'OpenAI rejected the API key. Check OPENAI_API_KEY in your .env file.',
  quota: 'OpenAI says the account is out of quota or rate limited.',
  safety: 'OpenAI declined this request under its content policy. Try rewording the prompt.',
  unsupported: 'That model is not available to this OpenAI account.',
  outage: 'OpenAI had a server problem.',
};

/**
 * OpenAI image adapter. Uses /images/generations for prompt-only nodes and
 * /images/edits when reference images are connected. The API key stays in
 * this process and is never sent to the browser or written to a board.
 */
export class OpenAIProvider implements ImageProvider {
  id = 'openai';
  label = 'OpenAI';
  private fetch: FetchLike;
  private baseUrl: string;

  constructor(private opts: OpenAIOptions) {
    this.fetch = opts.fetch ?? fetch;
    this.baseUrl = (opts.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  }

  capabilities() {
    return { models: IMAGE_MODEL_LIST.map((m) => m.id), maxReferences: 16, aspectRatios: ASPECT_RATIOS, qualities: ALL_QUALITIES };
  }

  /** Cheap check that OpenAI accepts the key (lists models; nothing is billed). */
  async verifyKey() {
    let res: Response;
    try {
      res = await this.fetch(`${this.baseUrl}/models`, { headers: { Authorization: `Bearer ${this.opts.apiKey}` }, signal: AbortSignal.timeout(20_000) });
    } catch (err) {
      throw new ProviderError(`Couldn't reach OpenAI to check the key (${err instanceof Error ? err.message : 'network error'}). Check your internet connection and try again.`, 'transient', true);
    }
    if (res.ok) return;
    const body = (await res.json().catch(() => ({}))) as OpenAIErrorBody;
    if (res.status === 401) throw new ProviderError('OpenAI rejected this key. Copy it again from platform.openai.com/api-keys; it may have been revoked or mistyped.', 'auth');
    if (res.status === 403) throw new ProviderError(`OpenAI says this key isn't allowed to do that. ${body.error?.message ?? ''}`.trim(), 'auth');
    throw new ProviderError(`OpenAI couldn't check the key right now (${res.status}). Try again in a minute.`, 'outage', true);
  }

  async generateImage(req: ImageGenerationRequest): Promise<ImageGenerationResult> {
    const model = getModel(req.model);
    const size = apiSize(req.model, req.aspectRatio);
    if (!model || !size) throw new ProviderError(`${req.model} can't make ${req.aspectRatio} images.`, 'unsupported');
    const quality = apiQuality(req.quality);

    const maxRetries = this.opts.maxRetries ?? 2;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.attempt(req, size, quality);
      } catch (err) {
        const pe = err instanceof ProviderError ? err : new ProviderError(String(err), 'internal');
        if (!pe.retryable || attempt >= maxRetries || req.signal.aborted) throw pe;
        // Back off before retrying a transient failure.
        await new Promise((r) => setTimeout(r, (this.opts.retryDelayMs ?? 2000) * 2 ** attempt));
      }
    }
  }

  private async attempt(req: ImageGenerationRequest, size: string, quality: string): Promise<ImageGenerationResult> {
    const timeout = AbortSignal.timeout(this.opts.timeoutMs ?? 5 * 60_000);
    const signal = AbortSignal.any([req.signal, timeout]);
    const headers: Record<string, string> = { Authorization: `Bearer ${this.opts.apiKey}` };
    let url: string;
    let body: BodyInit;

    if (req.references.length === 0) {
      url = `${this.baseUrl}/images/generations`;
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify({ model: req.model, prompt: req.prompt, size, quality, n: 1, output_format: 'png' });
    } else {
      url = `${this.baseUrl}/images/edits`;
      const form = new FormData();
      form.set('model', req.model);
      form.set('prompt', req.prompt);
      form.set('size', size);
      form.set('quality', quality);
      form.set('n', '1');
      form.set('output_format', 'png');
      for (const ref of req.references.slice(0, 16)) {
        const data = await readFile(ref.path);
        form.append('image[]', new Blob([new Uint8Array(data)], { type: ref.mime }), `${ref.id}.${ref.mime.split('/')[1] ?? 'png'}`);
      }
      body = form;
    }

    let res: Response;
    try {
      res = await this.fetch(url, { method: 'POST', headers, body, signal });
    } catch (err) {
      if (req.signal.aborted) throw new ProviderError('Canceled.', 'canceled');
      if (timeout.aborted) throw new ProviderError('OpenAI took too long to respond.', 'transient', true);
      throw new ProviderError(`Couldn't reach OpenAI (${err instanceof Error ? err.message : 'network error'}).`, 'transient', true);
    }

    const requestId = res.headers.get('x-request-id');
    if (!res.ok) {
      const errBody = (await res.json().catch(() => ({}))) as OpenAIErrorBody;
      const { category, retryable } = classify(res.status, errBody);
      const detail = errBody.error?.message ? ` ${errBody.error.message}` : '';
      const base = FRIENDLY[category] ?? `OpenAI returned ${res.status}.`;
      throw new ProviderError(`${base}${category === 'invalid_input' || category === 'unsupported' ? detail : ''}${requestId ? ` (request ${requestId})` : ''}`.trim(), category, retryable);
    }

    const json = (await res.json()) as OpenAIImageResponse;
    const mime = MIME[json.output_format ?? 'png'] ?? 'image/png';
    const images = (json.data ?? []).filter((d) => d.b64_json).map((d) => ({ data: Buffer.from(d.b64_json!, 'base64'), mime }));
    if (!images.length) throw new ProviderError('OpenAI returned no image.', 'outage', true);
    const u = json.usage;
    const usage = u
      ? Object.fromEntries(
          Object.entries({
            inputTokens: u.input_tokens,
            outputTokens: u.output_tokens,
            totalTokens: u.total_tokens,
            inputTextTokens: u.input_tokens_details?.text_tokens,
            inputImageTokens: u.input_tokens_details?.image_tokens,
          }).filter(([, v]) => typeof v === 'number'),
        ) as Record<string, number>
      : undefined;
    return { images, usage };
  }
}
