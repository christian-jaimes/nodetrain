import { ReactFlowProvider, useReactFlow } from '@xyflow/react';
import { useEffect, useRef, useState } from 'react';
import { AccountSettings } from './components/AccountSettings';
import { Canvas } from './components/Canvas';
import { Inspector } from './components/Inspector';
import { Busy, HintBar, NodePicker, ServerBanner, StartScreen, TemplatesModal, TitleBar, Toast } from './components/Overlays';
import { Sidebar } from './components/Sidebar';
import { useBoard } from './store/board';
import { FIT_OPTIONS } from './lib/ui';

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}

function Workspace() {
  const loaded = useBoard((s) => s.loaded);
  const showStart = useBoard((s) => s.showStart);
  const empty = useBoard((s) => s.nodes.length === 0);
  const templatesOpen = useBoard((s) => s.templatesOpen);
  const settingsOpen = useBoard((s) => s.settingsOpen);
  const [collapsed, setCollapsed] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const { fitView } = useReactFlow();
  const boardId = useBoard((s) => s.boardId);
  const open = boardId !== null;
  const galleryOpen = useBoard((s) => s.galleryOpen);
  const starting = open && showStart && empty;

  // Opening the start page folds the sidebar into its bar; the user can expand it again.
  useEffect(() => {
    if (starting) setCollapsed(true);
  }, [starting]);

  useEffect(() => {
    void useBoard.getState().init();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useBoard.getState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'k') {
        e.preventDefault();
        if (!s.boardId) return;
        setCollapsed(false);
        setTimeout(() => searchRef.current?.focus(), 0);
        return;
      }
      if (s.galleryOpen) {
        // The gallery covers the canvas: only Escape does anything, and only when a workflow is open to go back to.
        if (e.key === 'Escape' && s.boardId) s.setGalleryOpen(false);
        return;
      }
      if (mod && e.key === 'Enter') {
        e.preventDefault();
        const sel = s.nodes.filter((n) => n.selected);
        if (sel.length === 1) {
          if (sel[0].type === 'imageGeneration') void s.run(sel[0].id, false);
        } else void s.run();
        return;
      }
      if (isTyping(e)) return;
      if (mod && key === 'z' && !e.shiftKey) {
        e.preventDefault();
        s.undo();
      } else if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) {
        e.preventDefault();
        s.redo();
      } else if (mod && key === 'g') {
        e.preventDefault();
        if (e.shiftKey) s.ungroup();
        else s.groupSelection();
      } else if (!mod && !e.altKey && key === 'v') s.setTool('select');
      else if (!mod && !e.altKey && key === 'h') s.setTool('move');
      else if (mod && key === 'c') s.copySelection();
      else if (mod && key === 'v') s.paste();
      else if (mod && key === 'd') {
        e.preventDefault();
        s.duplicateSelection();
      } else if (e.shiftKey && e.key === '!') void fitView(FIT_OPTIONS);
      else if (e.key === 'Escape') s.select(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fitView]);

  return (
    <div className={`app ${collapsed ? 'is-collapsed' : ''}`}>
      {/* DOM order is the Tab order: sidebar, title, canvas, inspector. Panels float above the canvas by z-index. */}
      {galleryOpen ? <div className="scrim" onClick={() => useBoard.getState().boardId && useBoard.getState().setGalleryOpen(false)} /> : null}
      <Sidebar ref={searchRef} collapsed={collapsed} onToggle={() => setCollapsed(!collapsed)} />
      {open && !starting ? <TitleBar /> : null}
      <Canvas />
      {loaded && starting ? <StartScreen /> : null}
      {open ? <Inspector /> : null}
      {open && !starting && !galleryOpen ? <HintBar key={boardId} /> : null}
      <NodePicker />
      {templatesOpen ? <TemplatesModal /> : null}
      {settingsOpen ? <AccountSettings /> : null}
      <Toast />
      <ServerBanner />
      <Busy />
    </div>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <Workspace />
    </ReactFlowProvider>
  );
}
