import { useReactFlow, useViewport } from '@xyflow/react';
import { ArrowRight, Check, ChevronDown, CloudOff, Layers, LoaderCircle, MousePointer2, Plus, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CATALOG, NODE_KINDS, getPort } from '../../shared/graph/catalog';
import type { NodeKind } from '../../shared/graph/types';
import { TEMPLATES } from '../graph/templates';
import { useBoard } from '../store/board';
import { NodeIconTile } from './icons';

export function TitleBar() {
  const name = useBoard((s) => s.name);
  const setName = useBoard((s) => s.setName);
  const saveState = useBoard((s) => s.saveState);
  const newBlank = useBoard((s) => s.newBlank);
  const setTemplatesOpen = useBoard((s) => s.setTemplatesOpen);
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState(false);
  const [draft, setDraft] = useState(name);

  return (
    <div className="titlebar">
      {editing ? (
        <input
          className="titlebar__input"
          autoFocus
          value={draft}
          aria-label="Workflow name"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            setName(draft);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') setEditing(false);
          }}
        />
      ) : (
        <button className="titlebar__name" onClick={() => setMenu(!menu)} aria-haspopup="menu" aria-expanded={menu}>
          {name} <ChevronDown size={17} />
        </button>
      )}
      <span className={`save-state save-state--${saveState}`} aria-live="polite">
        {saveState === 'saving' ? (
          <>
            <LoaderCircle size={12} className="spin" /> Saving
          </>
        ) : saveState === 'saved' ? (
          <>
            <Check size={12} /> Saved
          </>
        ) : saveState === 'error' ? (
          <>
            <CloudOff size={12} /> Not saved
          </>
        ) : null}
      </span>
      {menu ? (
        <>
          <div className="backdrop-clear" onClick={() => setMenu(false)} />
          <div className="menu" role="menu">
            <button
              role="menuitem"
              onClick={() => {
                setDraft(name);
                setEditing(true);
                setMenu(false);
              }}
            >
              Rename
            </button>
            <button
              role="menuitem"
              onClick={() => {
                setTemplatesOpen(true);
                setMenu(false);
              }}
            >
              Browse templates
            </button>
            <button
              role="menuitem"
              onClick={() => {
                void newBlank();
                setMenu(false);
              }}
            >
              New blank workflow
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

export function StartScreen() {
  const setShowStart = useBoard((s) => s.setShowStart);
  const setTemplatesOpen = useBoard((s) => s.setTemplatesOpen);
  return (
    <div className="start">
      <h1>Create your workflow</h1>
      <p>Start from a blank canvas or use a template to build faster.</p>
      <div className="start__cards">
        <button className="start-card start-card--primary" onClick={() => setShowStart(false)} autoFocus>
          <span className="start-card__icon">
            <Plus size={26} />
          </span>
          <span className="start-card__text">
            <strong>Blank workflow</strong>
            <span>Start from scratch and build your own workflow.</span>
          </span>
          <ArrowRight size={20} />
        </button>
        <button className="start-card" onClick={() => setTemplatesOpen(true)}>
          <span className="start-card__icon">
            <Layers size={24} />
          </span>
          <span className="start-card__text">
            <strong>Browse templates</strong>
            <span>Use a ready-made workflow and customize it.</span>
          </span>
          <ArrowRight size={20} />
        </button>
      </div>
    </div>
  );
}

export function TemplatesModal() {
  const setTemplatesOpen = useBoard((s) => s.setTemplatesOpen);
  const loadTemplate = useBoard((s) => s.loadTemplate);
  const [q, setQ] = useState('');
  const list = TEMPLATES.filter((t) => (t.name + t.description + t.tags.join(' ')).toLowerCase().includes(q.toLowerCase()));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setTemplatesOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setTemplatesOpen]);

  return (
    <div className="modal-backdrop" onClick={() => setTemplatesOpen(false)}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="tpl-title" onClick={(e) => e.stopPropagation()}>
        <header className="modal__head">
          <span className="start-card__icon">
            <Layers size={26} />
          </span>
          <div>
            <h2 id="tpl-title">Browse templates</h2>
            <p>Get started with a ready-made workflow and customize it for your needs.</p>
          </div>
          <button className="icon-btn" onClick={() => setTemplatesOpen(false)} aria-label="Close">
            <X size={20} />
          </button>
        </header>
        <label className="search search--wide">
          <Search size={16} aria-hidden />
          <input autoFocus placeholder="Search templates..." value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search templates" />
        </label>
        <div className="tpl-grid">
          {list.map((t, i) => (
            <article key={t.id} className={`tpl ${i === 0 ? 'tpl--featured' : ''}`}>
              <div className="tpl__preview" aria-hidden>
                {t.preview.map((kind, k) => (
                  <NodeIconTile key={k} kind={kind} />
                ))}
              </div>
              <h3>{t.name}</h3>
              <p>{t.description}</p>
              <footer>
                {t.tags.map((tag) => (
                  <span key={tag} className="tag">
                    {tag}
                  </span>
                ))}
                <button
                  className={i === 0 ? 'primary-btn primary-btn--sm' : 'secondary-btn secondary-btn--sm'}
                  onClick={() => void loadTemplate(t)}
                >
                  Use template <ArrowRight size={14} />
                </button>
              </footer>
            </article>
          ))}
          {!list.length ? <p className="muted">No templates match “{q}”.</p> : null}
        </div>
      </div>
    </div>
  );
}

/** Searchable "add node" menu, opened by double-click or by dropping a dragged connection on empty canvas. */
export function NodePicker() {
  const picker = useBoard((s) => s.picker);
  const setPicker = useBoard((s) => s.setPicker);
  const addNode = useBoard((s) => s.addNode);
  const nodes = useBoard((s) => s.nodes);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const fromType = useMemo(() => {
    if (!picker?.from) return undefined;
    const n = nodes.find((x) => x.id === picker.from!.nodeId);
    return n ? getPort(n.type as NodeKind, picker.from.handleType, picker.from.handleId)?.type : undefined;
  }, [picker, nodes]);

  const options = NODE_KINDS.filter((k) => {
    if (fromType) {
      const ports = picker!.from!.handleType === 'source' ? CATALOG[k].inputs : CATALOG[k].outputs;
      if (!ports.some((p) => p.type === fromType)) return false;
    }
    return CATALOG[k].label.toLowerCase().includes(q.toLowerCase());
  });

  if (!picker) return null;
  const close = () => {
    setPicker(null);
    setQ('');
    setActive(0);
  };
  const choose = (kind: NodeKind) => {
    // Place the new node so its connecting side sits near the pointer.
    const offsetX = picker.from?.handleType === 'target' ? -320 : 0;
    addNode(kind, { x: picker.flow.x + offsetX, y: picker.flow.y - 40 }, picker.from);
    close();
  };
  const left = Math.min(picker.screen.x, window.innerWidth - 300);
  const top = Math.min(picker.screen.y, window.innerHeight - 280);

  return (
    <>
      <div className="backdrop-clear" onClick={close} onContextMenu={close} />
      <div className="picker" style={{ left, top }} role="dialog" aria-label={picker.from ? 'Create connected node' : 'Add node'}>
        <div className="picker__title">{picker.from ? 'Create connected node' : 'Add node'}</div>
        <label className="search">
          <Search size={15} aria-hidden />
          <input
            autoFocus
            placeholder="Search nodes..."
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close();
              if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, options.length - 1));
              if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
              if (e.key === 'Enter' && options[active]) choose(options[active]);
            }}
            aria-label="Search nodes"
          />
        </label>
        <ul ref={listRef} className="picker__list" role="listbox">
          {options.map((k, i) => (
            <li key={k} role="option" aria-selected={i === active}>
              <button className={i === active ? 'is-active' : ''} onMouseEnter={() => setActive(i)} onClick={() => choose(k)}>
                <NodeIconTile kind={k} size="sm" />
                <span>
                  {CATALOG[k].label}
                  <small>{CATALOG[k].description}</small>
                </span>
              </button>
            </li>
          ))}
          {!options.length ? <li className="muted small pad">{fromType ? 'No node accepts this type yet.' : 'No matches.'}</li> : null}
        </ul>
      </div>
    </>
  );
}

export function ServerBanner() {
  const offline = useBoard((s) => s.offline);
  const saveState = useBoard((s) => s.saveState);
  const saveError = useBoard((s) => s.saveError);
  const init = useBoard((s) => s.init);
  const boardId = useBoard((s) => s.boardId);
  const save = useBoard((s) => s.save);
  if (offline) {
    return (
      <div className="banner" role="alert">
        <CloudOff size={18} />
        <span>
          Can't reach the NodeTrain server, so changes aren't being saved. Start it with <code>npm run dev</code>.
        </span>
        <button className="secondary-btn secondary-btn--sm" onClick={() => (boardId ? void save().catch(() => {}) : void init())}>
          Retry
        </button>
      </div>
    );
  }
  if (saveState === 'error' && saveError) {
    return (
      <div className="banner" role="alert">
        <CloudOff size={18} />
        <span>{saveError}</span>
        <button className="secondary-btn secondary-btn--sm" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }
  return null;
}

export function Busy() {
  const busy = useBoard((s) => s.busy);
  if (!busy) return null;
  return (
    <div className="busy" role="status">
      <div>
        <LoaderCircle size={18} className="spin" /> {busy}
      </div>
    </div>
  );
}

export function Toast() {
  const toast = useBoard((s) => s.toast);
  if (!toast) return null;
  return (
    <div className={`toast toast--${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'}>
      {toast.text}
    </div>
  );
}

export function HintBar() {
  return (
    <div className="hintbar">
      <MousePointer2 size={15} /> Double-click to create node <span>·</span> Drag from a port to connect <span>·</span> Pinch to zoom
    </div>
  );
}

export function ZoomControls() {
  const { zoomIn, zoomOut, zoomTo } = useReactFlow();
  const { zoom } = useViewport();
  return (
    <div className="zoom">
      <button className="icon-btn icon-btn--sm" onClick={() => void zoomOut({ duration: 150 })} aria-label="Zoom out">
        −
      </button>
      <button className="zoom__value" onClick={() => void zoomTo(1, { duration: 200 })} title="Reset to 100%">
        {Math.round(zoom * 100)}%
      </button>
      <button className="icon-btn icon-btn--sm" onClick={() => void zoomIn({ duration: 150 })} aria-label="Zoom in">
        +
      </button>
    </div>
  );
}
