import { chmodSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProviderStatus } from '../../shared/api';
import { OpenAIProvider } from './openai';
import { SimulatedProvider } from './simulated';
import { ProviderError, type ImageProvider } from './types';

type Secrets = { openaiApiKey?: string };

export type ProviderManagerOptions = {
  dataDir: string;
  /** Key from the environment or .env, if any. */
  envKey?: string;
  baseUrl?: string;
  /** NODETRAIN_PROVIDER=simulated: never call a model, whatever key is set. */
  forceSimulated?: boolean;
  /** Injected in tests. */
  fetch?: typeof fetch;
  simulated?: ImageProvider;
};

/** "sk-…abcd": enough to recognise a key without revealing it. */
function hint(key: string) {
  return `${key.slice(0, 3)}…${key.slice(-4)}`;
}

/**
 * Decides which image provider runs use, and holds the OpenAI key. A key
 * saved from the app is stored in data/secrets.json (readable only by this
 * user where the OS supports it) and takes priority over OPENAI_API_KEY in
 * .env. Keys only ever travel browser → server, never back.
 */
export class ProviderManager {
  private file: string;
  private savedKey: string | undefined;
  private provider!: ImageProvider;
  private simulated: ImageProvider;

  constructor(private opts: ProviderManagerOptions) {
    this.file = join(opts.dataDir, 'secrets.json');
    this.simulated = opts.simulated ?? new SimulatedProvider();
    this.savedKey = this.readSecrets().openaiApiKey;
    this.rebuild();
  }

  /** A manager that always uses one provider, for tests. */
  static fixed(dataDir: string, provider: ImageProvider) {
    return new ProviderManager({ dataDir, forceSimulated: true, simulated: provider });
  }

  current() {
    return this.provider;
  }

  status(): ProviderStatus {
    const key = this.activeKey();
    return {
      provider: { id: this.provider.id, label: this.provider.label },
      key: key ? { source: key.source, hint: hint(key.value) } : null,
      envKeyPresent: Boolean(this.opts.envKey),
      forcedSimulated: Boolean(this.opts.forceSimulated),
    };
  }

  /** Checks the key with OpenAI, then saves it and switches runs to OpenAI. */
  async setKey(raw: unknown) {
    const key = typeof raw === 'string' ? raw.trim() : '';
    if (!key) throw new ProviderError('Paste an API key first.', 'invalid_input');
    if (/\s/.test(key) || key.length < 20 || key.length > 400) throw new ProviderError("That doesn't look like an OpenAI API key. Keys start with sk- and have no spaces.", 'invalid_input');
    await new OpenAIProvider({ apiKey: key, baseUrl: this.opts.baseUrl, fetch: this.opts.fetch }).verifyKey();
    this.writeSecrets({ ...this.readSecrets(), openaiApiKey: key });
    this.savedKey = key;
    this.rebuild();
    return this.status();
  }

  clearKey() {
    const { openaiApiKey: _, ...rest } = this.readSecrets();
    this.writeSecrets(rest);
    this.savedKey = undefined;
    this.rebuild();
    return this.status();
  }

  private activeKey(): { source: 'app' | 'env'; value: string } | undefined {
    if (this.savedKey) return { source: 'app', value: this.savedKey };
    if (this.opts.envKey) return { source: 'env', value: this.opts.envKey };
    return undefined;
  }

  private rebuild() {
    const key = this.activeKey();
    this.provider =
      key && !this.opts.forceSimulated ? new OpenAIProvider({ apiKey: key.value, baseUrl: this.opts.baseUrl, fetch: this.opts.fetch }) : this.simulated;
  }

  private readSecrets(): Secrets {
    if (!existsSync(this.file)) return {};
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as Secrets;
    } catch {
      return {};
    }
  }

  private writeSecrets(s: Secrets) {
    if (!Object.keys(s).length) {
      if (existsSync(this.file)) unlinkSync(this.file);
      return;
    }
    // Write then rename, so a crash never leaves a half-written file.
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
    try {
      chmodSync(this.file, 0o600);
    } catch {
      // Windows ignores POSIX modes; the file lives in the user's own folder.
    }
  }
}
