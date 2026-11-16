import { useReactFlow } from '@xyflow/react';
import { Box, ChevronDown, ChevronRight, LayoutGrid, Plus, Search, Workflow } from 'lucide-react';
import { forwardRef, useEffect, useState } from 'react';
import { CATALOG, NODE_KINDS } from '../../shared/graph/catalog';
import type { NodeKind } from '../../shared/graph/types';
import { TEMPLATES } from '../graph/templates';
import { useBoard } from '../store/board';
import { AccountButton } from './AccountSettings';
import { DRAG_MIME } from './Canvas';
import { NODE_ICONS } from './icons';

export function Logo() {
  return (
    <span className="logo">
      <span className="logo__mark" aria-hidden>
        <i />
        <i />
        <i />
        <i />
      </span>
      <span className="logo__word">
        nodetrain<sup>®</sup>
      </span>
    </span>
  );
}

const FAMILIES = ['Inputs', 'AI'] as const;

function timeAgo(t: number) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
}

export const Sidebar = forwardRef<HTMLInputElement, { collapsed: boolean; onToggle: () => void }>(function Sidebar({ collapsed, onToggle }, searchRef) {
  const [tab, setTab] = useState<'nodes' | 'workflows'>('nodes');
  const [query, setQuery] = useState('');
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const addNode = useBoard((s) => s.addNode);
  const loadTemplate = useBoard((s) => s.loadTemplate);
  const newBlank = useBoard((s) => s.newBlank);
  const openBoard = useBoard((s) => s.openBoard);
  const refreshBoards = useBoard((s) => s.refreshBoards);
  const boards = useBoard((s) => s.boards);
  const boardId = useBoard((s) => s.boardId);
  const name = useBoard((s) => s.name);

  useEffect(() => {
    if (tab === 'workflows') void refreshBoards();
  }, [tab, refreshBoards]);
  const { screenToFlowPosition } = useReactFlow();

  if (collapsed) {
    return (
      <aside className="panel sidebar sidebar--collapsed">
        <button className="sidebar__brand" onClick={onToggle} aria-label="nodetrain: open sidebar">
          <Logo />
          <ChevronRight size={16} />
        </button>
        <AccountButton compact />
      </aside>
    );
  }

  const q = query.trim().toLowerCase();
  const addAtCenter = (kind: NodeKind) => {
    const pos = screenToFlowPosition({ x: window.innerWidth / 2 - 150, y: window.innerHeight / 2 - 120 });
    addNode(kind, { x: pos.x + Math.random() * 40, y: pos.y + Math.random() * 40 });
  };

  return (
    <aside className="panel sidebar" aria-label="Node library">
      <button className="sidebar__brand" onClick={onToggle} aria-label="nodetrain: collapse sidebar">
        <Logo />
        <ChevronRight size={16} className="flip" />
      </button>
      <nav className="sidebar__tabs">
        <button className={`side-tab ${tab === 'workflows' ? 'is-active' : ''}`} onClick={() => setTab('workflows')}>
          <LayoutGrid size={17} /> Workflows
        </button>
        <button className={`side-tab ${tab === 'nodes' ? 'is-active' : ''}`} onClick={() => setTab('nodes')}>
          <Box size={17} /> Nodes
        </button>
      </nav>

      {tab === 'nodes' ? (
        <>
          <label className="search">
            <Search size={16} aria-hidden />
            <input ref={searchRef} placeholder="Search nodes..." value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search nodes" />
            <kbd>⌘K</kbd>
          </label>
          <div className="sidebar__list">
            {FAMILIES.map((family) => {
              const kinds = NODE_KINDS.filter((k) => CATALOG[k].family === family && CATALOG[k].label.toLowerCase().includes(q));
              if (!kinds.length) return null;
              const isClosed = closed[family] && !q;
              return (
                <section key={family} className="lib-group">
                  <button className="lib-group__head" onClick={() => setClosed({ ...closed, [family]: !closed[family] })} aria-expanded={!isClosed}>
                    <ChevronDown size={15} className={isClosed ? 'rot' : ''} />
                    {family}
                  </button>
                  {!isClosed &&
                    kinds.map((kind) => {
                      const Icon = NODE_ICONS[kind];
                      return (
                        <button
                          key={kind}
                          className="lib-item"
                          draggable
                          onDragStart={(e) => {
                            e.dataTransfer.setData(DRAG_MIME, kind);
                            e.dataTransfer.effectAllowed = 'copy';
                          }}
                          onClick={() => addAtCenter(kind)}
                          title={`${CATALOG[kind].description} Drag onto the canvas or click to add.`}
                        >
                          <Icon size={17} />
                          {CATALOG[kind].label}
                        </button>
                      );
                    })}
                </section>
              );
            })}
            {q && !NODE_KINDS.some((k) => CATALOG[k].label.toLowerCase().includes(q)) ? <p className="muted pad">No nodes match “{query}”.</p> : null}
          </div>
        </>
      ) : (
        <div className="sidebar__list">
          <button className="lib-item lib-item--action" onClick={() => void newBlank()}>
            <Plus size={17} /> New workflow
          </button>
          <div className="lib-group__head lib-group__head--static">Your workflows</div>
          {boards.map((b) => (
            <button key={b.id} className={`lib-item lib-item--tall ${b.id === boardId ? 'is-current' : ''}`} onClick={() => void openBoard(b.id)} aria-current={b.id === boardId}>
              <Workflow size={17} />
              <span>
                {b.id === boardId ? name : b.name}
                <small>
                  {b.nodeCount} node{b.nodeCount === 1 ? '' : 's'} · {timeAgo(b.updatedAt)}
                </small>
              </span>
            </button>
          ))}
          <div className="lib-group__head lib-group__head--static">Templates</div>
          {TEMPLATES.map((t) => (
            <button key={t.id} className="lib-item lib-item--tall" onClick={() => void loadTemplate(t)}>
              <LayoutGrid size={17} />
              <span>
                {t.name}
                <small>{t.description}</small>
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="sidebar__footer">
        <AccountButton />
      </div>
    </aside>
  );
});
