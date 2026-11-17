import { useViewport } from '@xyflow/react';
import { useEffect, useId, useRef } from 'react';

export type DotPatternProps = {
  /** Distance between dot centres at 100% zoom, in CSS pixels. */
  gap?: number;
  /** Dot radius at 100% zoom, in CSS pixels. */
  size?: number;
  /** How strongly dots near the pointer light up. 0 turns the glow off. */
  glow?: number;
  glowColor?: string;
  /** Reach of the glow around the pointer, in screen pixels. */
  radius?: number;
  color?: string;
  className?: string;
};

/**
 * Dot grid for the canvas background. It follows the React Flow viewport, so
 * the dots pan and scale together with the nodes. Dots near the pointer glow
 * in `glowColor`. It never takes pointer events and does not animate on its
 * own, so reduced motion needs no special case.
 */
export function DotPattern({ gap = 18, size = 1, glow = 1, glowColor = '#FF0000', radius = 110, color = 'rgba(255, 255, 255, 0.2)', className }: DotPatternProps) {
  const { x, y, zoom } = useViewport();
  const id = useId();
  const ref = useRef<HTMLDivElement>(null);

  // The pointer position goes straight to CSS variables, so moving the mouse never re-renders React.
  useEffect(() => {
    const el = ref.current;
    const host = el?.parentElement;
    if (!el || !host) return;
    const move = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      el.style.setProperty('--dot-x', `${e.clientX - r.left}px`);
      el.style.setProperty('--dot-y', `${e.clientY - r.top}px`);
    };
    const leave = () => {
      el.style.setProperty('--dot-x', '-9999px');
      el.style.setProperty('--dot-y', '-9999px');
    };
    host.addEventListener('pointermove', move);
    host.addEventListener('pointerleave', leave);
    return () => {
      host.removeEventListener('pointermove', move);
      host.removeEventListener('pointerleave', leave);
    };
  }, []);

  // Pattern cells are drawn in flow units and transformed by the viewport, which is exactly what the nodes do.
  const transform = `translate(${x} ${y}) scale(${zoom})`;
  const mask = `radial-gradient(circle ${radius}px at var(--dot-x, -9999px) var(--dot-y, -9999px), #000 0%, transparent 100%)`;

  return (
    <div ref={ref} className={className} aria-hidden="true" style={{ ['--dot-x' as string]: '-9999px', ['--dot-y' as string]: '-9999px' }}>
      <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0 }}>
        <defs>
          <pattern id={`${id}-base`} width={gap} height={gap} patternUnits="userSpaceOnUse" patternTransform={transform}>
            <circle cx={gap / 2} cy={gap / 2} r={size} fill={color} />
          </pattern>
          <pattern id={`${id}-glow`} width={gap} height={gap} patternUnits="userSpaceOnUse" patternTransform={transform}>
            <circle cx={gap / 2} cy={gap / 2} r={size * 1.35} fill={glowColor} />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${id}-base)`} />
        {glow > 0 ? <rect width="100%" height="100%" fill={`url(#${id}-glow)`} opacity={Math.min(1, glow)} style={{ WebkitMaskImage: mask, maskImage: mask }} /> : null}
      </svg>
    </div>
  );
}
