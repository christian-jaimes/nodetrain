import { ReactFlowProvider, useReactFlow } from '@xyflow/react';
import { useEffect, useRef, useState } from 'react';
import { Canvas } from './components/Canvas';
import { Inspector } from './components/Inspector';
import { Busy, HintBar, NodePicker, ServerBanner, StartScreen, TemplatesModal, TitleBar, Toast, ZoomControls } from './components/Overlays';
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
  const [collapsed, setCollapsed] = useState(false);
  const [tab, setTab] = useState<'properties' | 'activity'>('properties');
  const searchRef = useRef<HTMLInputElement>(null);
  const { fitView } = useReactFlow();
  const starting = showStart && empty;

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
        setCollapsed(false);
        setTimeout(() => searchRef.current?.focus(), 0);
        return;
      }
      if (mod && e.key === 'Enter') {
        e.preventDefault();
        void s.run();
        return;
      }
      if (isTyping(e)) return;
      if (mod && key === 'z' && !e.shiftKey) {
        e.preventDefault();
        s.undo();
      } else if (mod && (key === 'y' || (key === 'z' && e.shiftKey))) {
        e.preventDefault();
        s.redo();
      } else if (mod && key === 'c') s.copySelection();
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
      <Canvas />
      {loaded && starting ? <StartScreen /> : null}
      <Sidebar ref={searchRef} collapsed={collapsed || starting} onToggle={() => setCollapsed(!collapsed)} />
      <TitleBar />
      {!starting ? <Inspector tab={tab} setTab={setTab} /> : null}
      {!starting ? <HintBar /> : null}
      {!starting ? <ZoomControls /> : null}
      <NodePicker />
      {templatesOpen ? <TemplatesModal /> : null}
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
