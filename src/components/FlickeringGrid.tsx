import { useEffect, useRef } from 'react';
import { cellLevel } from '../lib/flicker';

export type FlickeringGridProps = {
  /** Another layout of the same look. */
  seed?: number;
  /** Animation speed. 1 is normal, 0 holds the frame. */
  speed?: number;
  shape?: 'square' | 'dot';
  /** Side length of a cell, in CSS pixels. */
  size?: number;
  /** Space between two cells, in CSS pixels. */
  gap?: number;
  /** 0 is an even grid; higher values leave only the bright cells. */
  contrast?: number;
  /** How strongly cells show. At 1 the brightest cell is about 40% opaque. */
  intensity?: number;
  /** Size of the slow drifting patches of activity. Higher values make more, smaller patches. */
  scale?: number;
  color?: string;
  className?: string;
};

const LEVELS = 12;
const FRAME_MS = 1000 / 30;

/**
 * Decorative canvas background of softly flickering cells. It never takes
 * pointer events, stops when the tab is hidden, and shows a still frame when
 * the system asks for reduced motion.
 */
export function FlickeringGrid({ seed = 0, speed = 1, shape = 'square', size = 4, gap = 6, contrast = 1, intensity = 1, scale = 1, color = '#f4f4f6', className }: FlickeringGridProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const pitch = size + gap;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let w = 0;
    let h = 0;
    let dpr = 1;
    let raf = 0;
    let last = 0;
    let start = performance.now();

    const draw = (now: number) => {
      const t = ((now - start) / 1000) * speed;
      const cols = Math.ceil(w / pitch);
      const rows = Math.ceil(h / pitch);
      const params = { seed, t, contrast, patchCells: Math.max(2, 14 / scale) };
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = color;
      // Group cells by quantised opacity so each level is a single fill.
      const buckets: [number, number][][] = Array.from({ length: LEVELS }, () => []);
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const b = Math.floor(cellLevel(params, c, r) * (LEVELS - 1) + 0.5);
          if (b > 0) buckets[b].push([c * pitch + gap / 2, r * pitch + gap / 2]);
        }
      }
      for (let b = 1; b < LEVELS; b++) {
        const cells = buckets[b];
        if (!cells.length) continue;
        ctx.globalAlpha = Math.min(1, (b / (LEVELS - 1)) * 0.4 * intensity);
        ctx.beginPath();
        for (const [x, y] of cells) {
          if (shape === 'dot') {
            ctx.moveTo(x + size, y + size / 2);
            ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
          } else ctx.rect(x, y, size, size);
        }
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < FRAME_MS) return;
      last = now;
      draw(now);
    };

    const animated = () => speed > 0 && !reduced.matches;
    const begin = () => {
      cancelAnimationFrame(raf);
      if (animated()) raf = requestAnimationFrame(loop);
      else draw(start);
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      w = rect.width;
      h = rect.height;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      if (!animated()) draw(start);
    };

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    begin();
    start = performance.now();
    reduced.addEventListener('change', begin);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      reduced.removeEventListener('change', begin);
    };
  }, [seed, speed, shape, size, gap, contrast, intensity, scale, color]);

  return <canvas ref={ref} className={className} aria-hidden="true" />;
}
