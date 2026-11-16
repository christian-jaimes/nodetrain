import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import sharp, { type Metadata } from 'sharp';
import type { ImageAsset } from '../shared/graph/types';
import type { DB } from './db';

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_PIXELS = 50_000_000;
const FORMATS: Record<string, { mime: string; ext: string }> = {
  png: { mime: 'image/png', ext: 'png' },
  jpeg: { mime: 'image/jpeg', ext: 'jpg' },
  webp: { mime: 'image/webp', ext: 'webp' },
  gif: { mime: 'image/gif', ext: 'gif' },
};

export class ArtifactError extends Error {
  status: 400 | 404 | 413;
  constructor(message: string, status: 400 | 404 | 413 = 400) {
    super(message);
    this.status = status;
  }
}

type Row = {
  id: string;
  sha256: string;
  mime: string;
  name: string;
  width: number;
  height: number;
  bytes: number;
  path: string;
  thumb_path: string | null;
  provider: string | null;
  run_id: string | null;
  created_at: number;
};

export type SaveOptions = { name?: string; provider?: string; runId?: string; provenance?: Record<string, unknown> };

export class ArtifactStore {
  private dir: string;
  constructor(
    private db: DB,
    dataDir: string,
  ) {
    this.dir = join(dataDir, 'artifacts');
    mkdirSync(this.dir, { recursive: true });
  }

  toAsset(r: Row): ImageAsset {
    return {
      id: r.id,
      src: `/api/artifacts/${r.id}`,
      thumb: r.thumb_path ? `/api/artifacts/${r.id}/thumb` : undefined,
      name: r.name,
      width: r.width,
      height: r.height,
      mime: r.mime,
      createdAt: r.created_at,
      runId: r.run_id ?? undefined,
      provider: r.provider ?? undefined,
    };
  }

  /** Validates by decoding the file (not by trusting its name or header), then stores it once. */
  async save(data: Buffer, opts: SaveOptions = {}): Promise<ImageAsset> {
    if (data.length === 0) throw new ArtifactError('The file is empty.');
    if (data.length > MAX_UPLOAD_BYTES) throw new ArtifactError('Images must be 25 MB or smaller.', 413);
    let meta: Metadata;
    try {
      meta = await sharp(data, { limitInputPixels: MAX_PIXELS }).metadata();
    } catch {
      throw new ArtifactError('That file is not a readable image.');
    }
    const fmt = meta.format ? FORMATS[meta.format] : undefined;
    if (!fmt || !meta.width || !meta.height) throw new ArtifactError('Use a PNG, JPEG, WebP or GIF image.');

    const sha256 = createHash('sha256').update(data).digest('hex');
    const existing = this.db.prepare('SELECT * FROM artifacts WHERE sha256 = ?').get(sha256) as Row | undefined;
    if (existing && existsSync(join(this.dir, existing.path))) return this.toAsset(existing);

    const sub = sha256.slice(0, 2);
    mkdirSync(join(this.dir, sub), { recursive: true });
    const path = `${sub}/${sha256}.${fmt.ext}`;
    writeFileSync(join(this.dir, path), data);

    let thumbPath: string | null = null;
    if (Math.max(meta.width, meta.height) > 640) {
      thumbPath = `${sub}/${sha256}.thumb.webp`;
      await sharp(data, { limitInputPixels: MAX_PIXELS, animated: false })
        .rotate()
        .resize(640, 640, { fit: 'inside' })
        .webp({ quality: 82 })
        .toFile(join(this.dir, thumbPath));
    }

    const row: Row = {
      id: existing?.id ?? nanoid(12),
      sha256,
      mime: fmt.mime,
      name: (opts.name ?? `image.${fmt.ext}`).slice(0, 200),
      width: meta.width,
      height: meta.height,
      bytes: data.length,
      path,
      thumb_path: thumbPath,
      provider: opts.provider ?? null,
      run_id: opts.runId ?? null,
      created_at: Date.now(),
    };
    this.db
      .prepare(
        `INSERT OR REPLACE INTO artifacts (id, sha256, mime, name, width, height, bytes, path, thumb_path, provider, run_id, provenance, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(row.id, sha256, row.mime, row.name, row.width, row.height, row.bytes, path, thumbPath, row.provider, row.run_id, opts.provenance ? JSON.stringify(opts.provenance) : null, row.created_at);
    return this.toAsset(row);
  }

  get(id: string): ImageAsset | undefined {
    const r = this.db.prepare('SELECT * FROM artifacts WHERE id = ?').get(id) as Row | undefined;
    return r ? this.toAsset(r) : undefined;
  }

  getMany(ids: string[]): ImageAsset[] {
    return ids.map((id) => this.get(id)).filter((a): a is ImageAsset => !!a);
  }

  /** Absolute file path for serving or for sending to a provider. */
  file(id: string, variant: 'full' | 'thumb' = 'full'): { path: string; mime: string } | undefined {
    const r = this.db.prepare('SELECT path, thumb_path, mime FROM artifacts WHERE id = ?').get(id) as Pick<Row, 'path' | 'thumb_path' | 'mime'> | undefined;
    if (!r) return undefined;
    if (variant === 'thumb' && r.thumb_path) return { path: join(this.dir, r.thumb_path), mime: 'image/webp' };
    return { path: join(this.dir, r.path), mime: r.mime };
  }
}
