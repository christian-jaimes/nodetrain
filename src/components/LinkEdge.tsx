import { BaseEdge, EdgeLabelRenderer, getBezierPath, useReactFlow, type EdgeProps } from '@xyflow/react';
import { X } from 'lucide-react';
import { useRef, useState } from 'react';

/** A link with a small remove button on its midpoint, shown on hover or when the link is selected. Delete/Backspace also removes a selected link. */
export function LinkEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, selected, markerEnd, style, label }: EdgeProps) {
  const { deleteElements } = useReactFlow();
  const [hover, setHover] = useState(false);
  const timer = useRef<number>(0);
  const [path, lx, ly] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  const enter = () => {
    window.clearTimeout(timer.current);
    setHover(true);
  };
  const leave = () => {
    timer.current = window.setTimeout(() => setHover(false), 120);
  };
  return (
    <g onMouseEnter={enter} onMouseLeave={leave}>
      <BaseEdge id={id} path={path} markerEnd={markerEnd} style={style} interactionWidth={24} label={label} />
      {selected || hover ? (
        <EdgeLabelRenderer>
          <button
            className="edge-remove nodrag nopan"
            style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)` }}
            title="Remove link"
            aria-label="Remove link"
            onMouseEnter={enter}
            onMouseLeave={leave}
            onClick={() => void deleteElements({ edges: [{ id }] })}
          >
            <X size={12} strokeWidth={3} />
          </button>
        </EdgeLabelRenderer>
      ) : null}
    </g>
  );
}
