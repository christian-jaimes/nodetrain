import sharp from 'sharp';
import { MAX_OUTPUT_PIXELS, normalizeOptions, type TransformOptions } from '../shared/graph/transforms';
import { ProviderError } from './providers/types';

/** Stay under the artifact store's 25 MB limit; lossless PNG gives way to WebP only for very large results. */
const PNG_BUDGET = 24 * 1024 * 1024;

const invalid = (message: string) => new ProviderError(message, 'invalid_input');

/** Opens an image upright (EXIF rotation applied) with its first frame only. */
const open = (input: Buffer) => sharp(input, { limitInputPixels: 50_000_000 }).rotate();

async function size(input: Buffer) {
  const { data, info } = await open(input).toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height };
}

function checkPixels(w: number, h: number) {
  if (w * h > MAX_OUTPUT_PIXELS) throw invalid(`The result would be ${w} × ${h} pixels, which is too large. Pick a smaller size.`);
}

/**
 * Makes the plain background around the edges transparent. The background colour is read from the image border, then
 * every connected pixel of a similar colour reachable from the border is removed. Subject pixels that happen to match
 * the background but are enclosed by the subject (a white label on a white bottle) are kept.
 */
async function removeBackground(input: Buffer, o: TransformOptions): Promise<Buffer> {
  const { data, info } = await open(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const at = (x: number, y: number) => (y * w + x) * 4;

  // Background colour: per-channel median of the opaque border pixels.
  const samples: number[][] = [[], [], []];
  const sample = (x: number, y: number) => {
    const i = at(x, y);
    if (data[i + 3] < 200) return;
    for (let c = 0; c < 3; c++) samples[c].push(data[i + c]);
  };
  for (let x = 0; x < w; x++) {
    sample(x, 0);
    sample(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    sample(0, y);
    sample(w - 1, y);
  }
  const hasBorderPixels = samples[0].length > 0;
  const bg = samples.map((s) => (s.length ? s.sort((a, b) => a - b)[s.length >> 1] : 255));
  const limit = Number(o.tolerance) * 3; // of a maximum colour distance of about 441
  const limitSq = limit * limit;

  const isBackground = (i: number) => {
    if (data[i + 3] < 16) return true;
    if (!hasBorderPixels) return false;
    const dr = data[i] - bg[0];
    const dg = data[i + 1] - bg[1];
    const db = data[i + 2] - bg[2];
    return dr * dr + dg * dg + db * db <= limitSq;
  };

  const removed = new Uint8Array(w * h);
  const stack = new Uint32Array(w * h);
  let top = 0;
  const push = (x: number, y: number) => {
    const p = y * w + x;
    if (removed[p] || !isBackground(p * 4)) return;
    removed[p] = 1;
    stack[top++] = p;
  };
  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }
  let count = 0;
  while (top > 0) {
    const p = stack[--top];
    count++;
    const x = p % w;
    const y = (p - x) / w;
    if (x > 0) push(x - 1, y);
    if (x < w - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < h - 1) push(x, y + 1);
  }

  const total = w * h;
  const alreadyTransparent = (() => {
    let n = 0;
    for (let p = 0; p < total; p++) if (data[p * 4 + 3] < 16) n++;
    return n;
  })();
  if (count - alreadyTransparent < total * 0.002) {
    throw invalid('No plain background was found around the edges, so nothing was removed. Try raising Tolerance, or use a picture with a solid-colour background.');
  }
  if (count > total * 0.995) {
    throw invalid('That would remove almost the whole image. Lower Tolerance, or use a picture where the subject differs from the background.');
  }

  // Alpha: 0 where removed, the original alpha elsewhere. Softness blurs the cut so the edge blends in.
  const soft = Number(o.softness);
  let kept: Buffer | null = null;
  if (soft > 0) {
    const mask = Buffer.alloc(total);
    for (let p = 0; p < total; p++) mask[p] = removed[p] ? 0 : 255;
    // sharp hands back 3 channels for a grey image, so take the first of each pixel.
    const { data: grey, info: gi } = await sharp(mask, { raw: { width: w, height: h, channels: 1 } }).blur(Math.max(0.3, soft)).raw().toBuffer({ resolveWithObject: true });
    kept = gi.channels === 1 ? grey : Buffer.from(grey.filter((_, i) => i % gi.channels === 0));
  }
  const alpha = Buffer.alloc(total);
  // A removed pixel stays fully transparent even when the blur spills onto it, so no background halo comes back.
  for (let p = 0; p < total; p++) alpha[p] = removed[p] ? 0 : kept ? Math.min(data[p * 4 + 3], kept[p]) : data[p * 4 + 3];
  for (let p = 0; p < total; p++) data[p * 4 + 3] = alpha[p];
  return sharp(data, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

async function upscale(input: Buffer, o: TransformOptions): Promise<Buffer> {
  const { data, w, h } = await size(input);
  const factor = parseInt(String(o.scale), 10);
  checkPixels(w * factor, h * factor);
  const sigma = { Smooth: 0, Balanced: 0.6, Crisp: 1.1 }[String(o.detail)] ?? 0.6;
  let img = sharp(data).resize(w * factor, h * factor, { kernel: 'lanczos3' });
  if (sigma) img = img.sharpen({ sigma });
  return img.toBuffer();
}

async function resize(input: Buffer, o: TransformOptions): Promise<Buffer> {
  const { data, w, h } = await size(input);
  const width = Number(o.width) || undefined;
  const height = Number(o.height) || undefined;
  const fit = { 'Fit inside': 'inside', 'Fill and crop': 'cover', Stretch: 'fill' }[String(o.fit)] as 'inside' | 'cover' | 'fill';
  // Work out the final size first so oversized requests fail with a clear message.
  const rw = width ?? Math.round((w * height!) / h);
  const rh = height ?? Math.round((h * width!) / w);
  checkPixels(rw, rh);
  return sharp(data).resize(rw, rh, { fit, kernel: 'lanczos3' }).toBuffer();
}

async function crop(input: Buffer, o: TransformOptions): Promise<Buffer> {
  const { data, w, h } = await size(input);
  const [rw, rh] = String(o.ratio).split(':').map(Number);
  const target = rw / rh;
  let cw = w;
  let ch = h;
  if (w / h > target) cw = Math.max(1, Math.round(h * target));
  else ch = Math.max(1, Math.round(w / target));
  return sharp(data)
    .extract({ left: Math.floor((w - cw) / 2), top: Math.floor((h - ch) / 2), width: cw, height: ch })
    .toBuffer();
}

async function trim(input: Buffer, o: TransformOptions): Promise<Buffer> {
  const { data } = await size(input);
  try {
    return await sharp(data).trim({ threshold: Number(o.threshold) }).toBuffer();
  } catch {
    throw invalid('There is no border to trim, or the image is a single colour.');
  }
}

async function rotate(input: Buffer, o: TransformOptions): Promise<Buffer> {
  const { data } = await size(input);
  const angle = { None: 0, '90° clockwise': 90, '180°': 180, '90° counterclockwise': 270 }[String(o.rotation)] ?? 0;
  let img = sharp(data);
  if (angle) img = img.rotate(angle);
  if (o.flip === 'Horizontal') img = img.flop();
  if (o.flip === 'Vertical') img = img.flip();
  return img.toBuffer();
}

async function adjust(input: Buffer, o: TransformOptions): Promise<Buffer> {
  const { data } = await size(input);
  const brightness = 1 + Number(o.brightness) / 100;
  const saturation = 1 + Number(o.saturation) / 100;
  const slope = 1 + Number(o.contrast) / 100; // 0 (flat grey) to 2 (double contrast), pivoting on mid-grey
  const meta = await sharp(data).metadata();
  let img = sharp(data).modulate({ brightness: Math.max(0, brightness), saturation: Math.max(0, saturation) });
  // linear() would also scale the alpha channel, so a picture with transparency is adjusted through its colour channels only.
  if (slope !== 1) {
    const channels = meta.hasAlpha ? [slope, slope, slope, 1] : slope;
    const offsets = meta.hasAlpha ? [128 * (1 - slope), 128 * (1 - slope), 128 * (1 - slope), 0] : 128 * (1 - slope);
    img = img.linear(channels, offsets);
  }
  return img.toBuffer();
}

const grayscale = async (input: Buffer) => open(input).grayscale().toBuffer();
const blur = async (input: Buffer, o: TransformOptions) => open(input).blur(Number(o.radius)).toBuffer();
const sharpen = async (input: Buffer, o: TransformOptions) => open(input).sharpen({ sigma: 0.5 + Number(o.amount) * 0.5 }).toBuffer();

const OPERATIONS: Record<string, (input: Buffer, o: TransformOptions) => Promise<Buffer>> = {
  removeBackground,
  upscale,
  resize,
  crop,
  trim,
  rotate,
  adjust,
  grayscale,
  blur,
  sharpen,
};

/** Encodes as lossless PNG, falling back to high-quality WebP (which keeps transparency) when a PNG would be too big to store. */
async function encode(buf: Buffer): Promise<{ data: Buffer; mime: string }> {
  const png = await sharp(buf).png({ compressionLevel: 6 }).toBuffer();
  if (png.length <= PNG_BUDGET) return { data: png, mime: 'image/png' };
  const webp = await sharp(buf).webp({ quality: 95 }).toBuffer();
  if (webp.length > PNG_BUDGET) throw invalid('The edited image is too large to store. Pick a smaller size.');
  return { data: webp, mime: 'image/webp' };
}

/** Applies one operation to one image and returns the result. Throws ProviderError for input problems. */
export async function applyTransform(input: Buffer, operation: string, options: TransformOptions): Promise<{ data: Buffer; mime: string }> {
  const run = OPERATIONS[operation];
  if (!run) throw invalid(`"${operation}" is not an available operation.`);
  try {
    return await encode(await run(input, normalizeOptions(operation, options)));
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    throw new ProviderError(`Couldn't edit this image: ${err instanceof Error ? err.message : 'unknown error'}`, 'internal');
  }
}
