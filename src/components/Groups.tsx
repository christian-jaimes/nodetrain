import { ViewportPortal } from '@xyflow/react';
import { Group, Ungroup } from 'lucide-react';
import { useMemo, useState } from 'react';
import { cleanGroups } from '../../shared/graph/document';
import type { AppNode } from '../../shared/graph/types';
import { useBoard } from '../store/board';

const PAD = 28;
const LABEL_H = 34;
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
 * Frames drawn around grouped nodes, plus a "Group" button above a multi-selection. A frame is computed from its
 * members' positions, so it follows them as they move. Clicking its label selects the whole group.
 */
export function Groups() {
  const nodes = useBoard((s) => s.nodes);
  const rawGroups = useBoard((s) => s.groups);
  const selectNodes = useBoard((s) => s.selectNodes);
  const ungroup = useBoard((s) => s.ungroup);
  const renameGroup = useBoard((s) => s.renameGroup);
  const groupSelection = useBoard((s) => s.groupSelection);
  const [editing, setEditing] = useState<string | null>(null);

  const groups = useMemo(() => cleanGroups(rawGroups, nodes.map((n) => n.id)), [rawGroups, nodes]);
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const selected = nodes.filter((n) => n.selected);
  const dragging = nodes.some((n) => n.dragging);
  // Offer to group when several nodes are selected that are not already exactly one group.
  const selIds = new Set(selected.map((n) => n.id));
  const alreadyGroup = groups.some((g) => g.nodeIds.length === selIds.size && g.nodeIds.every((id) => selIds.has(id)));
  const selBox = selected.length > 1 && !dragging && !alreadyGroup ? boundsOf(selected) : null;

  return (
    <ViewportPortal>
      {groups.map((g) => {
        const box = boundsOf(g.nodeIds.map((id) => byId.get(id)!).filter(Boolean));
        if (!box) return null;
        const members = g.nodeIds.map((id) => byId.get(id));
        const active = members.some((n) => n?.selected);
        return (
          <div
            key={g.id}
            className={`group-frame ${active ? 'is-active' : ''}`}
            style={{ transform: `translate(${box.x - PAD}px, ${box.y - PAD - LABEL_H}px)`, width: box.w + PAD * 2, height: box.h + PAD * 2 + LABEL_H }}
          >
            <div className="group-frame__label nodrag nopan">
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
                <button className="group-frame__title" onClick={() => selectNodes(g.nodeIds)} onDoubleClick={() => setEditing(g.id)} title="Click to select the group, double-click to rename">
                  {g.title}
                </button>
              )}
              <button className="group-frame__ungroup" onClick={() => ungroup(g.id)} title="Ungroup (Ctrl+Shift+G)" aria-label={`Ungroup ${g.title}`}>
                <Ungroup size={14} />
              </button>
            </div>
          </div>
        );
      })}
      {selBox ? (
        <div className="group-cta nodrag nopan" style={{ transform: `translate(${selBox.x + selBox.w / 2}px, ${selBox.y - 52}px)` }}>
          <button onClick={groupSelection} title="Group the selected nodes (Ctrl+G)">
            <Group size={15} /> Group {selected.length} nodes <kbd>Ctrl+G</kbd>
          </button>
        </div>
      ) : null}
    </ViewportPortal>
  );
}
