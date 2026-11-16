import { describe, expect, it } from 'vitest';
import { cellLevel, hash01, valueNoise } from '../src/lib/flicker';

const P = { seed: 8, t: 3.2, contrast: 0.75, patchCells: 14 / 1.2 };

describe('flicker maths', () => {
  it('is deterministic per seed and differs between seeds', () => {
    expect(hash01(8, 3, 4)).toBe(hash01(8, 3, 4));
    expect(hash01(8, 3, 4)).not.toBe(hash01(9, 3, 4));
    expect(cellLevel(P, 5, 6)).toBe(cellLevel(P, 5, 6));
    expect(cellLevel({ ...P, seed: 9 }, 5, 6)).not.toBe(cellLevel(P, 5, 6));
  });

  it('stays within 0..1 everywhere and over time', () => {
    for (let c = 0; c < 40; c++)
      for (let r = 0; r < 40; r++)
        for (const t of [0, 1.7, 55]) {
          const v = cellLevel({ ...P, t }, c, r);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
          const n = valueNoise(8, c / 3, r / 3);
          expect(n).toBeGreaterThanOrEqual(0);
          expect(n).toBeLessThanOrEqual(1);
        }
  });

  it('gives an even grid at contrast 0 and more spread at higher contrast', () => {
    expect(cellLevel({ ...P, contrast: 0 }, 2, 9)).toBeCloseTo(0.5, 10);
    const spread = (contrast: number) => {
      const vs: number[] = [];
      for (let c = 0; c < 30; c++) for (let r = 0; r < 30; r++) vs.push(cellLevel({ ...P, contrast }, c, r));
      const mean = vs.reduce((a, b) => a + b, 0) / vs.length;
      return vs.reduce((a, b) => a + (b - mean) ** 2, 0) / vs.length;
    };
    expect(spread(1.5)).toBeGreaterThan(spread(0.5));
  });
});
