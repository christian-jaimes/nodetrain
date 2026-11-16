import { Copy, FolderOpen, Layers, LayoutGrid, List, MoreHorizontal, Pencil, Plus, Search, Star, Trash2, Workflow, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { BoardSummary } from '../../shared/api';
import { SORT_LABELS, layoutPreview, timeAgo, visibleBoards, type GallerySort } from '../lib/gallery';
import { useBoard } from '../store/board';

/** Left column while the gallery is open: which set of workflows to show. */
export function GalleryRail() {
  const boards = useBoard((s) => s.boards);
  const filter = useBoard((s) => s.gallery.filter);
  const setGallery = useBoard((s) => s.setGallery);
  const favs = boards.filter((b) => b.favorite).length;
  return (
    <div className="rail" role="group" aria-label="Show">
      <button className={`rail__item ${filter === 'all' ? 'is-active' : ''}`} onClick={() => setGallery({ filter: 'all' })} aria-pressed={filter === 'all'}>
        <Layers size={17} /> All workflows <span className="rail__count">{boards.length}</span>
      </button>
      <button className={`rail__item ${filter === 'favorites' ? 'is-active' : ''}`} onClick={() => setGallery({ filter: 'favorites' })} aria-pressed={filter === 'favorites'}>
        <Star size={17} /> Favorites <span className="rail__count">{favs}</span>
      </button>
    </div>
  );
}

function Thumb({ preview }: { preview: BoardSummary['preview'] }) {
  const p = useMemo(() => layoutPreview(preview), [preview]);
  return (
    <svg className="thumb" viewBox={`0 0 ${p.width} ${p.height}`} aria-hidden preserveAspectRatio="xMidYMid meet">
      {p.edges.map((d, i) => (
        <path key={i} d={d} className="thumb__edge" />
      ))}
      {p.nodes.map((n) => (
        <rect key={n.id} x={n.x} y={n.y} width={p.nodeW} height={p.nodeH} rx={2.5} className={`thumb__node thumb__node--${n.type}`} />
      ))}
    </svg>
  );
}

type CardProps = {
  b: BoardSummary;
  selected: boolean;
  current: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onRemove: () => void;
};

function Card({ b, selected, current, onSelect, onOpen, onRemove }: CardProps) {
  const toggleFavorite = useBoard((s) => s.toggleFavorite);
  const duplicate = useBoard((s) => s.duplicateBoard);
  const rename = useBoard((s) => s.renameBoard);
  const [menu, setMenu] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(b.name);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopPropagation(), setMenu(false));
    const onDown = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenu(false);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onDown);
    };
  }, [menu]);

  const commitRename = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== b.name) void rename(b.id, draft);
  };
  const run = (fn: () => void) => () => {
    setMenu(false);
    fn();
  };

  return (
    <article
      className={`wf-card ${selected ? 'is-selected' : ''}`}
      onClick={onSelect}
      onDoubleClick={() => !editing && onOpen()}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && e.key === 'Enter') onOpen();
      }}
      tabIndex={0}
      aria-label={`${b.name}, ${b.nodeCount} nodes. Double-click or press Enter to open.`}
    >
      <Thumb preview={b.preview} />
      <button
        className={`wf-card__star ${b.favorite ? 'is-on' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          void toggleFavorite(b.id);
        }}
        onDoubleClick={(e) => e.stopPropagation()}
        aria-pressed={b.favorite}
        aria-label={b.favorite ? `Remove ${b.name} from favorites` : `Add ${b.name} to favorites`}
      >
        <Star size={17} fill={b.favorite ? 'currentColor' : 'none'} />
      </button>
      <div className="wf-card__more" ref={menuRef} onDoubleClick={(e) => e.stopPropagation()}>
        <button
          className="icon-btn icon-btn--sm"
          onClick={(e) => {
            e.stopPropagation();
            setMenu(!menu);
          }}
          aria-haspopup="menu"
          aria-expanded={menu}
          aria-label={`Actions for ${b.name}`}
        >
          <MoreHorizontal size={18} />
        </button>
        {menu ? (
          <div className="menu wf-menu" role="menu" onClick={(e) => e.stopPropagation()}>
            <button role="menuitem" onClick={run(onOpen)}>
              <FolderOpen size={15} /> Open
            </button>
            <button
              role="menuitem"
              onClick={run(() => {
                setDraft(b.name);
                setEditing(true);
              })}
            >
              <Pencil size={15} /> Rename
            </button>
            <button role="menuitem" onClick={run(() => void duplicate(b.id))}>
              <Copy size={15} /> Duplicate
            </button>
            <button role="menuitem" className="is-danger" onClick={run(onRemove)}>
              <Trash2 size={15} /> Remove
            </button>
          </div>
        ) : null}
      </div>
      <div className="wf-card__body">
        {editing ? (
          <input
            className="wf-card__rename"
            autoFocus
            value={draft}
            aria-label="Workflow name"
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') {
                setDraft(b.name);
                setEditing(false);
              }
            }}
          />
        ) : (
          <h3 className="wf-card__name" title={b.name}>
            {b.name}
          </h3>
        )}
        <p className="wf-card__meta">
          <span>
            {b.nodeCount} node{b.nodeCount === 1 ? '' : 's'}
          </span>
          {current ? <span className="wf-card__open">Open now</span> : null}
          <span className="wf-card__time">Modified {timeAgo(b.updatedAt)}</span>
        </p>
      </div>
    </article>
  );
}

export function Gallery() {
  const boards = useBoard((s) => s.boards);
  const boardId = useBoard((s) => s.boardId);
  const gallery = useBoard((s) => s.gallery);
  const loaded = useBoard((s) => s.loaded);
  const setGallery = useBoard((s) => s.setGallery);
  const setGalleryOpen = useBoard((s) => s.setGalleryOpen);
  const openBoard = useBoard((s) => s.openBoard);
  const newBlank = useBoard((s) => s.newBlank);
  const setTemplatesOpen = useBoard((s) => s.setTemplatesOpen);
  const removeBoard = useBoard((s) => s.removeBoard);
  const [selected, setSelected] = useState<string | null>(null);
  const [removing, setRemoving] = useState<BoardSummary | null>(null);

  const list = useMemo(() => visibleBoards(boards, gallery), [boards, gallery]);
  const filtering = gallery.query.trim() !== '' || gallery.filter === 'favorites';
  const open = (id: string) => void openBoard(id).then(() => setGalleryOpen(false));
  // openBoard returns early for the board already open, so close the gallery either way.

  return (
    <section className="gallery" aria-label="Workflow gallery">
      <header className="gallery__head">
        <div>
          <h2>Workflow gallery</h2>
          <p>Manage, organize, and open your workflows.</p>
        </div>
        <button className="primary-btn" onClick={() => void newBlank()}>
          <Plus size={16} /> New workflow
        </button>
        {boardId ? (
          <button className="icon-btn" onClick={() => setGalleryOpen(false)} aria-label="Close gallery">
            <X size={21} />
          </button>
        ) : null}
      </header>

      {boards.length > 0 ? (
        <div className="gallery__bar">
          <label className="search gallery__search">
            <Search size={16} aria-hidden />
            <input value={gallery.query} onChange={(e) => setGallery({ query: e.target.value })} placeholder="Search workflows..." aria-label="Search workflows" />
          </label>
          <div className="seg" role="group" aria-label="Layout">
            <button className={gallery.layout === 'grid' ? 'is-active' : ''} onClick={() => setGallery({ layout: 'grid' })} aria-label="Grid view" aria-pressed={gallery.layout === 'grid'}>
              <LayoutGrid size={16} />
            </button>
            <button className={gallery.layout === 'list' ? 'is-active' : ''} onClick={() => setGallery({ layout: 'list' })} aria-label="List view" aria-pressed={gallery.layout === 'list'}>
              <List size={16} />
            </button>
          </div>
          <select className="nt-select gallery__sort" value={gallery.sort} onChange={(e) => setGallery({ sort: e.target.value as GallerySort })} aria-label="Sort by">
            {(Object.keys(SORT_LABELS) as GallerySort[]).map((k) => (
              <option key={k} value={k}>
                {SORT_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="gallery__scroll">
        {loaded && boards.length === 0 ? (
          <div className="gallery__empty">
            <span className="gallery__empty-icon">
              <Workflow size={34} />
            </span>
            <h3>No workflows yet</h3>
            <p>Workflows are where you connect prompts, images and models. Start from a blank canvas or pick a template, and it will show up here.</p>
            <div className="gallery__empty-actions">
              <button className="primary-btn" onClick={() => void newBlank()}>
                <Plus size={16} /> Create your first workflow
              </button>
              <button className="primary-btn primary-btn--ghost" onClick={() => setTemplatesOpen(true)}>
                <Layers size={16} /> Browse templates
              </button>
            </div>
          </div>
        ) : list.length === 0 ? (
          <div className="gallery__empty gallery__empty--small">
            <h3>{gallery.filter === 'favorites' && !gallery.query.trim() ? 'No favorites yet' : 'No workflows match'}</h3>
            <p>{gallery.filter === 'favorites' && !gallery.query.trim() ? 'Click the star on a workflow to keep it here.' : 'Try a different search.'}</p>
            {filtering ? (
              <button className="secondary-btn" onClick={() => setGallery({ query: '', filter: 'all' })}>
                Show all workflows
              </button>
            ) : null}
          </div>
        ) : (
          <div className={`wf-grid ${gallery.layout === 'list' ? 'wf-grid--list' : ''}`}>
            {list.map((b) => (
              <Card key={b.id} b={b} selected={selected === b.id} current={b.id === boardId} onSelect={() => setSelected(b.id)} onOpen={() => open(b.id)} onRemove={() => setRemoving(b)} />
            ))}
          </div>
        )}
      </div>

      {removing ? (
        <div className="modal-backdrop" onClick={() => setRemoving(null)}>
          <div className="modal modal--narrow" role="alertdialog" aria-modal="true" aria-labelledby="rm-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="rm-title" className="confirm__title">
              Remove “{removing.name}”?
            </h2>
            <p className="muted">This permanently deletes the workflow. It can’t be undone. Images it generated stay on this computer and keep working in any copy.</p>
            <div className="confirm__actions">
              <button className="secondary-btn" onClick={() => setRemoving(null)} autoFocus>
                Cancel
              </button>
              <button
                className="primary-btn"
                onClick={() => {
                  const id = removing.id;
                  setRemoving(null);
                  void removeBoard(id);
                }}
              >
                <Trash2 size={15} /> Remove workflow
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
