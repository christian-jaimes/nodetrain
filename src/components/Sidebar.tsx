import { useReactFlow } from '@xyflow/react';
import { Box, ChevronDown, LayoutGrid, Search, Settings } from 'lucide-react';
import { forwardRef, useState } from 'react';
import { CATALOG, NODE_KINDS } from '../../shared/graph/catalog';
import type { NodeKind } from '../../shared/graph/types';
import { useBoard } from '../store/board';
import { AccountButton } from './AccountSettings';
import { DRAG_MIME } from './Canvas';
import { Gallery, GalleryRail } from './Gallery';
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

/**
 * One floating panel with a fixed-width column (brand, navigation, footer) on the left.
 * The Workflows button widens the panel across the screen and reveals the gallery to the
 * right of that column; the column itself never changes width.
 */
export const Sidebar = forwardRef<HTMLInputElement, { collapsed: boolean; onToggle: () => void }>(function Sidebar({ collapsed, onToggle }, searchRef) {
  const [query, setQuery] = useState('');
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const addNode = useBoard((s) => s.addNode);
  const hasWorkflow = useBoard((s) => s.boardId !== null);
  const galleryOpen = useBoard((s) => s.galleryOpen);
  const setGalleryOpen = useBoard((s) => s.setGalleryOpen);
  const setSettingsOpen = useBoard((s) => s.setSettingsOpen);
  const { screenToFlowPosition } = useReactFlow();

  const showNodes = hasWorkflow && !galleryOpen && !collapsed;
  const q = query.trim().toLowerCase();
  const addAtCenter = (kind: NodeKind) => {
    const pos = screenToFlowPosition({ x: window.innerWidth / 2 - 150, y: window.innerHeight / 2 - 120 });
    addNode(kind, { x: pos.x + Math.random() * 40, y: pos.y + Math.random() * 40 });
  };

  // Collapsed: a single bar with the logo, name, settings and the expand chevron.
  const bar = hasWorkflow && collapsed && !galleryOpen;
  const cls = ['panel', 'sidebar', galleryOpen ? 'is-gallery' : bar ? 'is-bar' : showNodes ? 'is-expanded' : 'is-shorter'].join(' ');

  return (
    <aside className={cls} aria-label={galleryOpen ? 'Workflow gallery' : 'Sidebar'}>
      {bar ? (
        <div className="sidebar__bar">
          <Logo />
          <button className="icon-btn" onClick={() => setSettingsOpen(true)} aria-label="Account settings" title="Account settings">
            <Settings size={18} />
          </button>
          <button className="icon-btn" onClick={onToggle} aria-label="Expand sidebar" aria-expanded={false}>
            <ChevronDown size={18} />
          </button>
        </div>
      ) : (
      <div className="sidebar__col">
        <button
          className="sidebar__brand"
          onClick={onToggle}
          disabled={galleryOpen || !hasWorkflow}
          aria-label="nodetrain: collapse sidebar"
          aria-expanded={showNodes}
        >
          <Logo />
          {hasWorkflow && !galleryOpen ? <ChevronDown size={16} className="flip" /> : null}
        </button>
        <nav className="sidebar__tabs">
          <button className={`side-tab ${galleryOpen ? 'is-active' : ''}`} onClick={() => setGalleryOpen(!galleryOpen)} aria-pressed={galleryOpen}>
            <LayoutGrid size={17} /> Workflows
          </button>
          {hasWorkflow ? (
            <button
              className={`side-tab ${showNodes ? 'is-active' : ''}`}
              onClick={() => {
                setGalleryOpen(false);
                if (collapsed) onToggle();
              }}
              aria-pressed={showNodes}
            >
              <Box size={17} /> Nodes
            </button>
          ) : null}
        </nav>

        {galleryOpen ? <GalleryRail /> : null}

        {showNodes ? (
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
          <div className="sidebar__spacer" />
        )}
        <div className="sidebar__footer">
          <AccountButton />
        </div>
      </div>
      )}
      <div className="gallery-wrap" inert={!galleryOpen} aria-hidden={!galleryOpen}>
        <Gallery />
      </div>
    </aside>
  );
});
