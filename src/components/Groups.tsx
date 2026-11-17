import { ViewportPortal, useReactFlow } from '@xyflow/react';
import { useMemo, useRef, useState, type PointerEvent } from 'react';
import { cleanGroups } from '../../shared/graph/document';
import type { AppNode } from '../../shared/graph/types';
import { useBoard } from '../store/board';

const PAD = 28;
const HEADER = 44;
const FALLBACK = { w: 300, h: 160 };

type Box = { x: number; y: number; w: number; h: number };

function boundsOf(nodes: AppNode[]): Box | null {
  if (!nodes.length) return null;
  let x1 = Infinity;
  let y1 = Infinity;
  let x2 = -Infinity;
  let y2 = -Infinity;
  for (const n of nodes) {
    const w = n.measured?.width ?? n.width ?? FALLBACK.w;
    const h = n.measured?.height ?? n.height ?? FALLBACK.h;
    x1 = Math.min(x1, n.position.x);
    y1 = Math.min(y1, n.position.y);
    x2 = Math.max(x2, n.position.x + w);
    y2 = Math.max(y2, n.position.y + h);
  }
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/**
 * Containers drawn around grouped nodes. A container is sized from its members, so it follows them when they move,
 * and dragging the container moves every node inside it. Double-click the name to rename it.
 */
export function Groups() {
  const nodes = useBoard((s) => s.nodes);
  const rawGroups = useBoard((s) => s.groups);
  const selectNodes = useBoard((s) => s.selectNodes);
  const moveNodes = useBoard((s) => s.moveNodes);
  const commit = useBoard((s) => s.commit);
  const renameGroup = useBoard((s) => s.renameGroup);
  const groupSelection = useBoard((s) => s.groupSelection);
  const ungroup = useBoard((s) => s.ungroup);
  const { getZoom } = useReactFlow();
  const [editing, setEditing] = useState<string | null>(null);
  const drag = useRef<{ id: string; ids: string[]; x: number; y: number; moved: boolean } | null>(null);

  const groups = useMemo(() => cleanGroups(rawGroups, nodes.map((n) => n.id)), [rawGroups, nodes]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const selected = nodes.filter((n) => n.selected);
  const dragging = nodes.some((n) => n.dragging);
  const selIds = new Set(selected.map((n) => n.id));
  const exact = groups.find((g) => g.nodeIds.length === selIds.size && g.nodeIds.every((id) => selIds.has(id)));
  const selBox = selected.length > 1 && !dragging ? boundsOf(selected) : null;

  const onDown = (e: PointerEvent, id: string, ids: string[]) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('input')) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id, ids, x: e.clientX, y: e.clientY, moved: false };
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved) {
      if (Math.hypot(dx, dy) < 3) return;
      d.moved = true;
      commit(`group-move:${d.id}`);
      selectNodes(d.ids);
    }
    const z = getZoom();
    moveNodes(d.ids, dx / z, dy / z);
    d.x = e.clientX;
    d.y = e.clientY;
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) selectNodes(d.ids);
  };

  return (
    <ViewportPortal>
      {groups.map((g) => {
        const box = boundsOf(g.nodeIds.map((id) => byId.get(id)!).filter(Boolean));
        if (!box) return null;
        // Only a fully selected group counts as selected; picking one node inside it leaves the container as it was.
        const active = g.nodeIds.every((id) => byId.get(id)?.selected);
        return (
          <div
            key={g.id}
            className={`group-frame nopan nodrag ${active ? 'is-active' : ''}`}
            style={{ transform: `translate(${box.x - PAD}px, ${box.y - PAD - HEADER}px)`, width: box.w + PAD * 2, height: box.h + PAD * 2 + HEADER }}
            onPointerDown={(e) => onDown(e, g.id, g.nodeIds)}
            onPointerMove={onMove}
            onPointerUp={onUp}
            // The pointer is captured while pressing, so the double-click lands on the container rather than the name: check where it was.
            onDoubleClick={(e) => {
              if (e.clientY - e.currentTarget.getBoundingClientRect().top < HEADER * getZoom()) setEditing(g.id);
            }}
          >
            {editing === g.id ? (
              <input
                className="group-frame__input"
                autoFocus
                defaultValue={g.title}
                aria-label="Group name"
                onFocus={(e) => e.currentTarget.select()}
                onBlur={(e) => {
                  renameGroup(g.id, e.currentTarget.value);
                  setEditing(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                  if (e.key === 'Escape') setEditing(null);
                }}
              />
            ) : (
              <div className="group-frame__title" title="Drag to move the group, double-click to rename">
                {g.title}
              </div>
            )}
          </div>
        );
      })}
      {selBox ? (
        <div className="group-cta nodrag nopan" style={{ transform: `translate(${selBox.x + selBox.w / 2}px, ${selBox.y - PAD - HEADER - 48}px)` }}>
          {exact ? (
            <button onClick={() => ungroup(exact.id)} title="Dissolve this group (Ctrl+Shift+G)">
              Ungroup <kbd>Ctrl+Shift+G</kbd>
            </button>
          ) : (
            <button onClick={groupSelection} title="Group the selected nodes (Ctrl+G)">
              Group {selected.length} nodes <kbd>Ctrl+G</kbd>
            </button>
          )}
        </div>
      ) : null}
    </ViewportPortal>
  );
}
