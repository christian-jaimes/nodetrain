import sharp, { type OverlayOptions, type Sharp } from 'sharp';
import { aspectSize } from '../../shared/graph/catalog';
import { ALL_QUALITIES, ASPECT_RATIOS, IMAGE_MODEL_LIST } from '../../shared/graph/models';
import { ProviderError, type ImageGenerationRequest, type ImageGenerationResult, type ImageProvider } from './types';

function hashHue(text: string) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h % 360;
}

function escapeXml(s: string) {
  return s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
}

function wrapLines(text: string, maxChars: number, maxLines: number) {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > maxChars && line) {
      lines.push(line);
      line = w;
      if (lines.length === maxLines) return lines;
    } else line = (line + ' ' + w).trim();
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new ProviderError('Canceled.', 'canceled'));
    });
  });

/**
 * Stand-in provider used until an API key is configured. It composites the
 * reference images (first as backdrop, last as subject) or paints the prompt,
 * and stamps every output as simulated so it is never mistaken for model output.
 */
export class SimulatedProvider implements ImageProvider {
  id = 'simulated';
  label = 'Simulated (no model called)';
  constructor(private delayMs: [number, number] = [900, 1800]) {}

  capabilities() {
    return { models: IMAGE_MODEL_LIST.map((m) => m.id), maxReferences: 16, aspectRatios: ASPECT_RATIOS, qualities: ALL_QUALITIES };
  }

  async generateImage(req: ImageGenerationRequest): Promise<ImageGenerationResult> {
    const [lo, hi] = this.delayMs;
    await sleep(lo + Math.random() * (hi - lo), req.signal);
    const [w, h] = aspectSize(req.aspectRatio);
    const hue = hashHue(req.prompt + Date.now());
    const layers: OverlayOptions[] = [];
    let base: Sharp;

    if (req.references.length) {
      base = sharp(req.references[0].path).rotate().resize(w, h, { fit: 'cover' });
      layers.push({
        input: Buffer.from(
          `<svg width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="hsl(${hue},70%,70%)" stop-opacity="0.16"/>
            <stop offset="1" stop-color="hsl(${(hue + 40) % 360},60%,30%)" stop-opacity="0.22"/></linearGradient></defs>
            <rect width="100%" height="100%" fill="url(#g)"/></svg>`,
        ),
      });
      if (req.references.length > 1) {
        const subj = req.references[req.references.length - 1];
        const sh = Math.round(h * 0.72);
        const subject = await sharp(subj.path).rotate().resize({ height: sh, width: Math.round(w * 0.8), fit: 'inside' }).png().toBuffer();
        const sm = await sharp(subject).metadata();
        layers.push({ input: subject, left: Math.round((w - (sm.width ?? 0)) / 2), top: Math.round(h - (sm.height ?? 0) - h * 0.06) });
      }
    } else {
      base = sharp({ create: { width: w, height: h, channels: 3, background: '#111' } });
      const lines = wrapLines(req.prompt, 34, 6)
        .map((l, i) => `<text x="${w * 0.08}" y="${h * 0.3 + i * (w / 22)}" font-family="sans-serif" font-weight="600" font-size="${Math.round(w / 30)}" fill="white" fill-opacity="0.9">${escapeXml(l)}</text>`)
        .join('');
      layers.push({
        input: Buffer.from(
          `<svg width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stop-color="hsl(${hue},45%,22%)"/><stop offset="1" stop-color="hsl(${(hue + 50) % 360},55%,12%)"/></linearGradient></defs>
            <rect width="100%" height="100%" fill="url(#g)"/>${lines}</svg>`,
        ),
      });
    }
    layers.push({
      input: Buffer.from(
        `<svg width="${w}" height="${h}"><defs><radialGradient id="v" cx="50%" cy="50%" r="75%">
          <stop offset="0.45" stop-color="black" stop-opacity="0"/><stop offset="1" stop-color="black" stop-opacity="0.35"/></radialGradient></defs>
          <rect width="100%" height="100%" fill="url(#v)"/>
          <text x="${w * 0.03}" y="${h * 0.965}" font-family="sans-serif" font-size="${Math.round(w / 64)}" fill="white" fill-opacity="0.75">Simulated preview · no model was called</text></svg>`,
      ),
    });
    const data = await base.composite(layers).jpeg({ quality: 86 }).toBuffer();
    return { images: [{ data, mime: 'image/jpeg' }] };
  }
}
