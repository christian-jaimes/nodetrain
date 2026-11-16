import { api } from './api';
import type { ImageAsset } from '../../shared/graph/types';

const MAX_BYTES = 25 * 1024 * 1024;
const ACCEPTED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/** Quick checks before upload. The server decodes and validates the file itself. */
export async function importImage(file: File): Promise<ImageAsset> {
  if (!ACCEPTED.includes(file.type)) throw new Error(`${file.name}: use PNG, JPEG, WebP or GIF.`);
  if (file.size > MAX_BYTES) throw new Error(`${file.name}: larger than 25 MB.`);
  return api.upload(file, file.name);
}

export async function uploadDataUrl(dataUrl: string, name: string): Promise<ImageAsset> {
  const blob = await (await fetch(dataUrl)).blob();
  return api.upload(blob, name);
}

// ---------- Sample images for templates (drawn locally, no downloads) ----------

export function sampleBackdrop(variant: number): { dataUrl: string; name: string } {
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
  return { dataUrl: c.toDataURL('image/jpeg', 0.85), name: `backdrop-${variant + 1}.jpg` };
}

export function sampleBottle(): { dataUrl: string; name: string } {
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
  return { dataUrl: c.toDataURL('image/png'), name: 'serum-bottle.png' };
}

/** Crops an image file to a centred square and shrinks it, for a profile picture (a small JPEG data URL). */
export async function pictureFromFile(file: File, size = 192): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("That image couldn't be read. Try a PNG or JPEG.");
  }
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#1c1c21';
  ctx.fillRect(0, 0, size, size);
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.88);
}
