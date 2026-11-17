import { ArrowRight, Check, ChevronDown, CloudOff, Layers, LoaderCircle, MousePointer2, Plus, Search, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CATALOG, NODE_KINDS, getPort } from '../../shared/graph/catalog';
import type { NodeKind } from '../../shared/graph/types';
import { fromDocument } from '../../shared/graph/document';
import { TEMPLATES, type Template } from '../graph/templates';
import { useBoard } from '../store/board';
import { NodeIconTile } from './icons';

const SAVED_VISIBLE_MS = 3000;

export function TitleBar() {
  const name = useBoard((s) => s.name);
  const setName = useBoard((s) => s.setName);
  const saveState = useBoard((s) => s.saveState);
  const savedTick = useBoard((s) => s.savedTick);
  const boardId = useBoard((s) => s.boardId);
  const saveAsTemplate = useBoard((s) => s.saveAsTemplate);
  const removeBoard = useBoard((s) => s.removeBoard);
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState(name);
  const [showSaved, setShowSaved] = useState(false);
  const firstTick = useRef(savedTick);

  // "Saved" appears for a few seconds after each save, then goes away. Opening a workflow is not a save.
  useEffect(() => {
    if (savedTick === firstTick.current) return;
    setShowSaved(true);
    const t = setTimeout(() => setShowSaved(false), SAVED_VISIBLE_MS);
    return () => clearTimeout(t);
  }, [savedTick]);

  const startEditing = () => {
    setDraft(name);
    setEditing(true);
    setMenu(false);
  };

  return (
    <header className="titlebar">
      {editing ? (
        <input
          className="titlebar__input"
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          value={draft}
          aria-label="Workflow name"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            setName(draft);
            setEditing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              setDraft(name);
              setEditing(false);
            }
          }}
        />
      ) : (
        <button className="titlebar__name" onClick={() => setMenu(!menu)} onDoubleClick={startEditing} aria-haspopup="menu" aria-expanded={menu} title="Double-click to rename">
          {name} <ChevronDown size={17} />
        </button>
      )}
      <span className={`save-state save-state--${saveState === 'error' ? 'error' : 'saved'}`} aria-live="polite">
        {saveState === 'error' ? (
          <>
            <CloudOff size={12} /> Not saved
          </>
        ) : showSaved ? (
          <>
            <Check size={12} /> Saved
          </>
        ) : null}
      </span>
      {menu ? (
        <>
          <div className="backdrop-clear" onClick={() => setMenu(false)} />
          <div className="menu" role="menu">
            <button role="menuitem" onClick={startEditing}>
              Rename
            </button>
            <button
              role="menuitem"
              onClick={() => {
                setMenu(false);
                void saveAsTemplate();
              }}
            >
              Save as template
            </button>
            <button
              role="menuitem"
              className="is-danger"
              onClick={() => {
                setMenu(false);
                setConfirming(true);
              }}
            >
              Delete workflow
            </button>
          </div>
        </>
      ) : null}
      {confirming ? (
        <div className="modal-backdrop" onClick={() => setConfirming(false)}>
          <div className="modal modal--narrow" role="alertdialog" aria-modal="true" aria-labelledby="del-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="del-title" className="confirm__title">
              Delete “{name}”?
            </h2>
            <p className="muted">This permanently deletes the workflow. It can’t be undone. Images it generated stay on this computer.</p>
            <div className="confirm__actions">
              <button className="secondary-btn" onClick={() => setConfirming(false)} autoFocus>
                Cancel
              </button>
              <button
                className="primary-btn"
                onClick={() => {
                  setConfirming(false);
                  if (boardId) void removeBoard(boardId);
                }}
              >
                <Trash2 size={15} /> Delete workflow
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}

export function StartScreen() {
  const setShowStart = useBoard((s) => s.setShowStart);
  const setTemplatesOpen = useBoard((s) => s.setTemplatesOpen);
  return (
    <main className="start">
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
    </main>
  );
}

export function TemplatesModal() {
  const setTemplatesOpen = useBoard((s) => s.setTemplatesOpen);
  const loadTemplate = useBoard((s) => s.loadTemplate);
  const userTemplates = useBoard((s) => s.userTemplates);
  const deleteTemplate = useBoard((s) => s.deleteTemplate);
  const [q, setQ] = useState('');
  const mine = useMemo<Template[]>(
    () =>
      userTemplates.map((u) => ({
        id: `user:${u.id}`,
        name: u.name,
        description: 'Saved from one of your workflows.',
        tags: ['Your template'],
        preview: u.nodeKinds as NodeKind[],
        build: async () => ({ name: u.name, ...fromDocument(u.document) }),
      })),
    [userTemplates],
  );
  const list = [...mine, ...TEMPLATES].filter((t) => (t.name + t.description + t.tags.join(' ')).toLowerCase().includes(q.toLowerCase()));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setTemplatesOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setTemplatesOpen]);

  return (
    <div className="modal-backdrop" onClick={() => setTemplatesOpen(false)}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="tpl-title" onClick={(e) => e.stopPropagation()}>
        <div className="modal__head">
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
        </div>
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
                {t.id.startsWith('user:') ? (
                  <button className="icon-btn icon-btn--sm" onClick={() => void deleteTemplate(t.id.slice(5))} aria-label={`Delete template ${t.name}`} title="Delete template">
                    <Trash2 size={14} />
                  </button>
                ) : null}
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
          Can't reach the NodeTrain server, so changes aren't being saved. Make sure <code>npm run dev</code> is running, and check its terminal window for an error.
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

const HINT_VISIBLE_MS = 10000;

/** How-to tips, shown for about 10 seconds when a workflow opens: centered on a blank canvas, at the bottom on a workflow that already has nodes. */
export function HintBar() {
  const [blank] = useState(() => useBoard.getState().nodes.length === 0);
  const [phase, setPhase] = useState<'shown' | 'leaving' | 'gone'>('shown');
  useEffect(() => {
    const a = setTimeout(() => setPhase('leaving'), HINT_VISIBLE_MS - 500);
    const b = setTimeout(() => setPhase('gone'), HINT_VISIBLE_MS);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, []);
  if (phase === 'gone') return null;
  return (
    <div className={`hintbar ${blank ? 'hintbar--center' : ''} ${phase === 'leaving' ? 'is-leaving' : ''}`} role="region" aria-label="Canvas tips">
      <MousePointer2 size={15} /> Double-click to create node <span>·</span> Drag from a port to connect <span>·</span> Pinch to zoom
    </div>
  );
}
