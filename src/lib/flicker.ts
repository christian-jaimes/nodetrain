/** Maths for the flickering canvas background, kept free of the DOM so it can be tested. */

/** Deterministic hash of three integers to [0, 1). */
export function hash01(seed: number, a: number, b: number): number {
  let h = (Math.imul(a | 0, 374761393) + Math.imul(b | 0, 668265263) + Math.imul((seed | 0) + 1, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

const fade = (t: number) => t * t * (3 - 2 * t);

/** Smooth value noise in [0, 1] on a lattice, used for the slow drifting patches of activity. */
export function valueNoise(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = fade(x - x0);
  const fy = fade(y - y0);
  const a = hash01(seed, x0, y0);
  const b = hash01(seed, x0 + 1, y0);
  const c = hash01(seed, x0, y0 + 1);
  const d = hash01(seed, x0 + 1, y0 + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

export type GridParams = {
  seed: number;
  /** Seconds of animation, already multiplied by speed. */
  t: number;
  contrast: number;
  /** Width of one activity patch, in cells. */
  patchCells: number;
};

/** Brightness of one cell, 0 (dim) to 1 (bright). */
export function cellLevel(p: GridParams, col: number, row: number): number {
  const patch = valueNoise(p.seed, col / p.patchCells + p.t * 0.04, row / p.patchCells - p.t * 0.03);
  const rate = 0.6 + hash01(p.seed, col, row) * 1.8;
  const phase = hash01(p.seed + 101, col, row) * Math.PI * 2;
  const flicker = 0.5 + 0.5 * Math.sin(p.t * rate * 2 + phase);
  const level = patch * (0.35 + 0.65 * flicker);
  // contrast 0 is an even grid, higher values leave only the brightest cells.
  const v = 0.5 + (level - 0.5) * p.contrast * 2.6;
  return Math.min(1, Math.max(0, v));
}
