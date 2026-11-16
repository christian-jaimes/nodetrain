import { create } from 'zustand';
import { nanoid } from 'nanoid';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import type { NodeChangeset, EdgeChangeset, XYPosition } from '@xyflow/react';
import { CATALOG, getPort } from '../graph/catalog';
import { checkConnection, planRun, resolveInputs, runKey, validateNode, type CheckResult, type ConnectionLike } from '../graph/validate';
import { RUN_FIELDS, type AppEdge, type AppNode, type ImageGenerationData, type NodeData, type NodeKind } from '../graph/types';
import { simulateGeneration } from '../lib/images';
import type { Template } from '../graph/templates';

type Snapshot = { name: string; nodes: AppNode[]; edges: AppEdge[] };

export type ActivityEntry = {
  id: string;
  runId: string;
  nodeId: string;
  title: string;
  status: 'succeeded' | 'failed' | 'canceled';
  message: string;
  at: number;
};

export type Toast = { id: string; text: string; tone: 'info' | 'error' };

export type PickerState = {
  screen: XYPosition;
  flow: XYPosition;
  /** Present when the picker was opened by dragging out of a port. */
  from?: { nodeId: string; handleId: string; handleType: 'source' | 'target' };
};

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

type BoardState = {
  name: string;
  nodes: AppNode[];
  edges: AppEdge[];
  past: Snapshot[];
  future: Snapshot[];
  lastCommit: { key: string; at: number } | null;
  clipboard: { nodes: AppNode[]; edges: AppEdge[] } | null;
  activity: ActivityEntry[];
  running: boolean;
  cancelRequested: boolean;
  loaded: boolean;
  showStart: boolean;
  templatesOpen: boolean;
  saveState: SaveState;
  toast: Toast | null;
  picker: PickerState | null;
  /** Bumped when the whole board is replaced, so the canvas refits once nodes are measured. */
  fitNonce: number;

  commit: (key?: string) => void;
  undo: () => void;
  redo: () => void;
  onNodesChange: (changes: NodeChangeset<AppNode>) => void;
  onEdgesChange: (changes: EdgeChangeset<AppEdge>) => void;
  connect: (c: ConnectionLike) => CheckResult;
  addNode: (kind: NodeKind, position: XYPosition, from?: PickerState['from']) => string;
  updateData: (id: string, patch: Partial<NodeData>, key?: string) => void;
  setName: (name: string) => void;
  select: (id: string | null) => void;
  copySelection: () => void;
  paste: () => void;
  duplicateSelection: () => void;
  deleteSelection: () => void;
  run: (targetId?: string) => Promise<void>;
  cancelRun: () => void;
  selectOutput: (nodeId: string, outputId: string) => void;
  loadTemplate: (t: Template) => void;
  newBlank: () => void;
  setShowStart: (v: boolean) => void;
  setTemplatesOpen: (v: boolean) => void;
  setPicker: (p: PickerState | null) => void;
  notify: (text: string, tone?: Toast['tone']) => void;
  init: () => Promise<void>;
};

const HISTORY_LIMIT = 100;
const STORAGE_KEY = 'nodetrain:board:v1';

const strip = (n: AppNode): AppNode => {
  const { selected: _s, dragging: _d, ...rest } = n;
  return rest as AppNode;
};
const snapshot = (s: BoardState): Snapshot => ({ name: s.name, nodes: s.nodes.map(strip), edges: s.edges.map((e) => ({ ...e, selected: false })) });

/** Run results are evidence, not edits: undo/redo keeps the current ones. */
function keepRunState(restored: AppNode[], current: AppNode[]): AppNode[] {
  const byId = new Map(current.map((n) => [n.id, n]));
  return restored.map((n) => {
    const cur = byId.get(n.id);
    if (n.type !== 'imageGeneration' || cur?.type !== 'imageGeneration') return n;
    const data = { ...n.data } as Record<string, unknown>;
    for (const f of RUN_FIELDS) data[f] = cur.data[f];
    return { ...n, data } as AppNode;
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const useBoard = create<BoardState>((set, get) => ({
  name: 'Untitled workflow',
  nodes: [],
  edges: [],
  past: [],
  future: [],
  lastCommit: null,
  clipboard: null,
  activity: [],
  running: false,
  cancelRequested: false,
  loaded: false,
  showStart: false,
  templatesOpen: false,
  saveState: 'idle',
  toast: null,
  picker: null,
  fitNonce: 0,

  commit: (key) => {
    const s = get();
    const now = Date.now();
    if (key && s.lastCommit?.key === key && now - s.lastCommit.at < 1200) {
      set({ lastCommit: { key, at: now } });
      return;
    }
    set({ past: [...s.past, snapshot(s)].slice(-HISTORY_LIMIT), future: [], lastCommit: { key: key ?? nanoid(), at: now } });
  },

  undo: () => {
    const s = get();
    const prev = s.past[s.past.length - 1];
    if (!prev) return;
    set({
      past: s.past.slice(0, -1),
      future: [snapshot(s), ...s.future],
      name: prev.name,
      nodes: keepRunState(prev.nodes, s.nodes),
      edges: prev.edges,
      lastCommit: null,
    });
  },

  redo: () => {
    const s = get();
    const next = s.future[0];
    if (!next) return;
    set({
      future: s.future.slice(1),
      past: [...s.past, snapshot(s)],
      name: next.name,
      nodes: keepRunState(next.nodes, s.nodes),
      edges: next.edges,
      lastCommit: null,
    });
  },

  onNodesChange: (changes) => {
    if (changes.getByType('remove').length || changes.getByType('add').length) get().commit('delete');
    set({ nodes: changes.applyTo(get().nodes) });
  },

  onEdgesChange: (changes) => {
    if (changes.getByType('remove').length || changes.getByType('add').length) get().commit('delete');
    set({ edges: changes.applyTo(get().edges) });
  },

  connect: (c) => {
    const s = get();
    const result = checkConnection(s.nodes, s.edges, c);
    if (!result.ok) return result;
    s.commit();
    set({
      edges: [
        ...s.edges,
        { id: nanoid(8), source: c.source!, target: c.target!, sourceHandle: c.sourceHandle ?? null, targetHandle: c.targetHandle ?? null },
      ],
    });
    return result;
  },

  addNode: (kind, position, from) => {
    const s = get();
    const id = nanoid(8);
    const newNode = { id, type: kind, position, data: CATALOG[kind].create(), selected: true } as AppNode;
    let newEdge: AppEdge | null = null;
    if (from) {
      const fromNode = s.nodes.find((n) => n.id === from.nodeId);
      const fromPort = fromNode && getPort(fromNode.type as NodeKind, from.handleType, from.handleId);
      if (fromPort) {
        // Dragged out of an output: connect to the new node's matching input, and vice versa.
        const candidates = from.handleType === 'source' ? CATALOG[kind].inputs : CATALOG[kind].outputs;
        const match = candidates.find((p) => p.type === fromPort.type);
        if (match) {
          newEdge =
            from.handleType === 'source'
              ? { id: nanoid(8), source: from.nodeId, sourceHandle: from.handleId, target: id, targetHandle: match.id }
              : { id: nanoid(8), source: id, sourceHandle: match.id, target: from.nodeId, targetHandle: from.handleId };
        }
      }
    }
    s.commit();
    // Node and edge are committed together so one undo removes both.
    set({
      nodes: [...s.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)), newNode],
      edges: newEdge ? [...s.edges, newEdge] : s.edges,
      showStart: false,
    });
    return id;
  },

  updateData: (id, patch, key) => {
    get().commit(key ?? `data:${id}:${Object.keys(patch).join(',')}`);
    set({ nodes: get().nodes.map((n) => (n.id === id ? ({ ...n, data: { ...n.data, ...patch } } as AppNode) : n)) });
  },

  setName: (name) => {
    get().commit('rename');
    set({ name: name.trim() || 'Untitled workflow' });
  },

  select: (id) => set({ nodes: get().nodes.map((n) => ({ ...n, selected: n.id === id })) }),

  copySelection: () => {
    const s = get();
    const nodes = s.nodes.filter((n) => n.selected).map(strip);
    if (!nodes.length) return;
    const ids = new Set(nodes.map((n) => n.id));
    set({ clipboard: { nodes, edges: s.edges.filter((e) => ids.has(e.source) && ids.has(e.target)) } });
    s.notify(`Copied ${nodes.length} node${nodes.length > 1 ? 's' : ''}.`);
  },

  paste: () => {
    const s = get();
    if (!s.clipboard) return;
    const map = new Map<string, string>();
    const nodes = s.clipboard.nodes.map((n) => {
      const id = nanoid(8);
      map.set(n.id, id);
      return { ...n, id, selected: true, position: { x: n.position.x + 48, y: n.position.y + 48 } } as AppNode;
    });
    const edges = s.clipboard.edges.map((e) => ({ ...e, id: nanoid(8), source: map.get(e.source)!, target: map.get(e.target)! }));
    s.commit();
    set({
      nodes: [...s.nodes.map((n) => ({ ...n, selected: false })), ...nodes],
      edges: [...s.edges, ...edges],
      clipboard: { nodes: nodes.map(strip), edges },
    });
  },

  duplicateSelection: () => {
    get().copySelection();
    get().paste();
  },

  deleteSelection: () => {
    const s = get();
    const ids = new Set(s.nodes.filter((n) => n.selected).map((n) => n.id));
    const edgeSel = s.edges.filter((e) => e.selected).length;
    if (!ids.size && !edgeSel) return;
    s.commit();
    set({
      nodes: s.nodes.filter((n) => !ids.has(n.id)),
      edges: s.edges.filter((e) => !e.selected && !ids.has(e.source) && !ids.has(e.target)),
    });
  },

  run: async (targetId) => {
    const s = get();
    if (s.running) return;
    const order = planRun(s.nodes, s.edges, targetId);
    if (!order.length) {
      s.notify('Add an Image Generation node to run this workflow.');
      return;
    }
    const runId = nanoid(6);
    const patchRun = (id: string, patch: Partial<ImageGenerationData>) =>
      set({ nodes: get().nodes.map((n) => (n.id === id ? ({ ...n, data: { ...n.data, ...patch } } as AppNode) : n)) });
    const log = (nodeId: string, status: ActivityEntry['status'], message: string) => {
      const n = get().nodes.find((x) => x.id === nodeId);
      const entry: ActivityEntry = { id: nanoid(8), runId, nodeId, title: n?.data.title ?? 'Node', status, message, at: Date.now() };
      set({ activity: [entry, ...get().activity].slice(0, 200) });
    };

    set({ running: true, cancelRequested: false });
    order.forEach((id) => patchRun(id, { status: 'queued', error: undefined }));
    const failed = new Set<string>();

    for (const id of order) {
      if (get().cancelRequested) {
        patchRun(id, { status: 'idle' });
        log(id, 'canceled', 'Canceled before it started.');
        continue;
      }
      const { nodes, edges } = get();
      const node = nodes.find((n) => n.id === id);
      if (!node || node.type !== 'imageGeneration') continue;
      const upstreamFailed = edges.some((e) => e.target === id && failed.has(e.source));
      if (upstreamFailed) {
        failed.add(id);
        patchRun(id, { status: 'failed', error: 'An upstream step failed. Fix it and run again.' });
        log(id, 'failed', 'Skipped because an upstream step failed.');
        continue;
      }
      const issues = validateNode(node, nodes, edges);
      if (issues.length) {
        failed.add(id);
        const msg = issues[0].detail;
        patchRun(id, { status: 'failed', error: msg });
        log(id, 'failed', msg);
        continue;
      }
      patchRun(id, { status: 'running' });
      await sleep(900 + Math.random() * 900);
      // Re-read: the user may have kept editing while this was "running".
      const fresh = get().nodes.find((n) => n.id === id);
      if (!fresh || fresh.type !== 'imageGeneration') continue;
      const inputs = resolveInputs(fresh, get().nodes, get().edges);
      try {
        const img = await simulateGeneration(inputs.prompt, inputs.references, fresh.data.aspectRatio, runId);
        patchRun(id, {
          status: 'succeeded',
          outputs: [img, ...fresh.data.outputs].slice(0, 24),
          selectedOutputId: img.id,
          lastRunKey: runKey(fresh, get().nodes, get().edges),
          lastRunAt: Date.now(),
        });
        log(id, 'succeeded', `Generated 1 image with ${fresh.data.model} (simulated).`);
      } catch (err) {
        failed.add(id);
        const msg = err instanceof Error ? err.message : 'Generation failed.';
        patchRun(id, { status: 'failed', error: msg });
        log(id, 'failed', msg);
      }
    }
    set({ running: false, cancelRequested: false });
  },

  cancelRun: () => set({ cancelRequested: true }),

  selectOutput: (nodeId, outputId) => {
    get().commit();
    set({
      nodes: get().nodes.map((n) =>
        n.id === nodeId && n.type === 'imageGeneration' ? ({ ...n, data: { ...n.data, selectedOutputId: outputId } } as AppNode) : n,
      ),
    });
  },

  loadTemplate: (t) => {
    const built = t.build();
    get().commit();
    set({ name: built.name, nodes: built.nodes, edges: built.edges, showStart: false, templatesOpen: false, fitNonce: get().fitNonce + 1 });
  },

  newBlank: () => {
    get().commit();
    set({ name: 'Untitled workflow', nodes: [], edges: [], showStart: true });
  },

  setShowStart: (v) => set({ showStart: v }),
  setTemplatesOpen: (v) => set({ templatesOpen: v }),
  setPicker: (p) => set({ picker: p }),

  notify: (text, tone = 'info') => {
    const toast = { id: nanoid(6), text, tone };
    set({ toast });
    setTimeout(() => {
      if (get().toast?.id === toast.id) set({ toast: null });
    }, 3600);
  },

  init: async () => {
    try {
      const saved = await idbGet<{ name: string; nodes: AppNode[]; edges: AppEdge[]; activity: ActivityEntry[] }>(STORAGE_KEY);
      if (saved?.nodes) {
        // A run interrupted by a refresh can't still be going: show it as not run.
        const nodes = saved.nodes.map((n) =>
          n.type === 'imageGeneration' && (n.data.status === 'running' || n.data.status === 'queued')
            ? ({ ...n, data: { ...n.data, status: n.data.outputs.length ? 'succeeded' : 'idle' } } as AppNode)
            : n,
        );
        set({ name: saved.name, nodes, edges: saved.edges, activity: saved.activity ?? [], showStart: nodes.length === 0, saveState: 'saved', fitNonce: 1 });
      } else {
        set({ showStart: true });
      }
    } catch {
      set({ showStart: true, saveState: 'error' });
    }
    set({ loaded: true });
  },
}));

// ---------- Autosave ----------

let saveTimer: ReturnType<typeof setTimeout> | undefined;
useBoard.subscribe((s, prev) => {
  if (!s.loaded) return;
  if (s.nodes === prev.nodes && s.edges === prev.edges && s.name === prev.name && s.activity === prev.activity) return;
  // Selection and drag flags are UI state; skip saves when only they changed.
  if (s.saveState !== 'saving') useBoard.setState({ saveState: 'saving' });
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const { name, nodes, edges, activity } = useBoard.getState();
    try {
      await idbSet(STORAGE_KEY, { name, nodes: nodes.map(strip), edges, activity, savedAt: Date.now() });
      useBoard.setState({ saveState: 'saved' });
    } catch {
      useBoard.setState({ saveState: 'error' });
    }
  }, 500);
});

export function exportWorkflow() {
  const { name, nodes, edges } = useBoard.getState();
  const doc = {
    format: 'nodetrain.workflow',
    version: 1,
    exportedAt: new Date().toISOString(),
    name,
    nodes: nodes.map(strip),
    edges: edges.map(({ id, source, target, sourceHandle, targetHandle }) => ({ id, source, target, sourceHandle, targetHandle })),
  };
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name.replace(/[^\w-]+/g, '-').toLowerCase() || 'workflow'}.nodetrain.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
