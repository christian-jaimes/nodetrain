import { nanoid } from 'nanoid';
import type { ImageAsset } from '../graph/types';

const MAX_SIDE = 1280;
const MAX_BYTES = 25 * 1024 * 1024;
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode image.'));
    img.src = src;
  });
}

/** Read, validate and downscale an uploaded image into an asset. */
export async function importImage(file: File): Promise<ImageAsset> {
  if (!ACCEPTED.includes(file.type)) throw new Error(`${file.name}: use PNG, JPEG, WebP or GIF.`);
  if (file.size > MAX_BYTES) throw new Error(`${file.name}: larger than 25 MB.`);
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
    const keepAlpha = file.type === 'image/png' || file.type === 'image/webp';
    const src = canvas.toDataURL(keepAlpha ? 'image/webp' : 'image/jpeg', 0.88);
    return { id: nanoid(10), src, name: file.name, width: w, height: h, createdAt: Date.now() };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function aspectSize(aspect: string): [number, number] {
  switch (aspect) {
    case '3:2':
      return [1152, 768];
    case '2:3':
      return [768, 1152];
    case '16:9':
      return [1280, 720];
    case '1:1':
      return [1024, 1024];
    default:
      return [1152, 768];
  }
}

function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number) {
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const iw = img.naturalWidth * s;
  const ih = img.naturalHeight * s;
  ctx.drawImage(img, (w - iw) / 2, (h - ih) / 2, iw, ih);
}

function hashHue(text: string) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h % 360;
}

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lh: number, maxLines: number) {
  const words = text.split(/\s+/);
  let line = '';
  let lines = 0;
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y + lines * lh);
      line = word;
      if (++lines >= maxLines) return;
    } else line = test;
  }
  if (line) ctx.fillText(line, x, y + lines * lh);
}

/**
 * Prototype stand-in for a real image model. Composes the reference images
 * (first as backdrop, second as subject) or paints a prompt card. Step 3 of
 * the plan replaces this with an OpenAI call made by the local server.
 */
export async function simulateGeneration(prompt: string, refs: ImageAsset[], aspect: string, runId: string): Promise<ImageAsset> {
  const [w, h] = aspectSize(aspect);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const hue = hashHue(prompt + runId);

  if (refs.length > 0) {
    const bg = await loadImage(refs[0].src);
    drawCover(ctx, bg, w, h);
    // Warm light wash + soft vignette so variants differ.
    const wash = ctx.createLinearGradient(0, 0, w, h);
    wash.addColorStop(0, `hsla(${hue}, 70%, 70%, 0.16)`);
    wash.addColorStop(1, `hsla(${(hue + 40) % 360}, 60%, 30%, 0.22)`);
    ctx.fillStyle = wash;
    ctx.fillRect(0, 0, w, h);
    if (refs.length > 1) {
      const subj = await loadImage(refs[refs.length - 1].src);
      const sh = h * 0.72;
      const sw = (subj.naturalWidth / subj.naturalHeight) * sh;
      const sx = (w - sw) / 2 + ((hue % 60) - 30) * (w / 900);
      ctx.save();
      ctx.shadowColor = 'rgba(40,20,10,0.45)';
      ctx.shadowBlur = 40;
      ctx.shadowOffsetX = 18;
      ctx.shadowOffsetY = 10;
      ctx.drawImage(subj, sx, h - sh - h * 0.06, sw, sh);
      ctx.restore();
    }
  } else {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, `hsl(${hue}, 45%, 22%)`);
    g.addColorStop(1, `hsl(${(hue + 50) % 360}, 55%, 12%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.font = `600 ${Math.round(w / 30)}px Inter, system-ui, sans-serif`;
    wrap(ctx, prompt, w * 0.08, h * 0.3, w * 0.84, w / 22, 6);
  }
  const vignette = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);

  ctx.font = `500 ${Math.round(w / 64)}px Inter, system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText('Simulated preview · no model was called', w * 0.03, h - h * 0.035);

  return {
    id: nanoid(10),
    src: canvas.toDataURL('image/jpeg', 0.86),
    name: `generation-${runId}.jpg`,
    width: w,
    height: h,
    createdAt: Date.now(),
    runId,
  };
}

// ---------- Sample images for templates (drawn locally, no downloads) ----------

export function sampleBackdrop(variant: number): ImageAsset {
  const w = 900;
  const h = 640;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  const tones = [
    ['#e9c9a4', '#c99a6c'],
    ['#efd9c2', '#d6b394'],
    ['#e3c3a0', '#b98a5e'],
  ][variant % 3];
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, tones[0]);
  g.addColorStop(1, tones[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // Window-light shadows.
  ctx.fillStyle = 'rgba(90,50,20,0.16)';
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    const x = 120 + i * 190 + variant * 40;
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 70, 0);
    ctx.lineTo(x - 160, h);
    ctx.lineTo(x - 230, h);
    ctx.closePath();
    ctx.fill();
  }
  // Pedestal.
  ctx.fillStyle = 'rgba(245,232,215,0.9)';
  ctx.fillRect(w * 0.25, h * 0.78, w * 0.5, h * 0.22);
  ctx.fillStyle = 'rgba(120,80,50,0.18)';
  ctx.fillRect(w * 0.25, h * 0.78, w * 0.5, 6);
  return { id: nanoid(10), src: c.toDataURL('image/jpeg', 0.85), name: `backdrop-${variant + 1}.jpg`, width: w, height: h, createdAt: Date.now() };
}

export function sampleBottle(): ImageAsset {
  const w = 400;
  const h = 640;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  // Transparent background so it composites onto the backdrop.
  const cx = w / 2;
  // Dropper bulb.
  ctx.fillStyle = '#1d1a18';
  ctx.beginPath();
  ctx.roundRect(cx - 34, 40, 68, 120, 30);
  ctx.fill();
  ctx.fillRect(cx - 52, 150, 104, 60);
  // Glass body.
  const glass = ctx.createLinearGradient(cx - 120, 0, cx + 120, 0);
  glass.addColorStop(0, '#4a2410');
  glass.addColorStop(0.35, '#8b4a1f');
  glass.addColorStop(0.6, '#6b3415');
  glass.addColorStop(1, '#3a1a0a');
  ctx.fillStyle = glass;
  ctx.beginPath();
  ctx.roundRect(cx - 120, 205, 240, 420, 34);
  ctx.fill();
  // Label.
  ctx.fillStyle = '#f2e6d8';
  ctx.fillRect(cx - 120, 380, 240, 245);
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.fillRect(cx - 90, 220, 18, 150);
  return { id: nanoid(10), src: c.toDataURL('image/png'), name: 'serum-bottle.png', width: w, height: h, createdAt: Date.now() };
}
