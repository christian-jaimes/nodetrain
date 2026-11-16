import { create } from 'zustand';
import { nanoid } from 'nanoid';
import { del as idbDel, get as idbGet } from 'idb-keyval';
import type { NodeChangeset, EdgeChangeset, XYPosition } from '@xyflow/react';
import type { BoardPayload, BoardRunState, BoardSummary, NodeExecutionView, Profile, RunView } from '../../shared/api';
import { CATALOG, getPort } from '../../shared/graph/catalog';
import { fromDocument, migrateDocument, toDocument } from '../../shared/graph/document';
import { checkConnection, planRun, type CheckResult, type ConnectionLike } from '../../shared/graph/validate';
import { RUN_FIELDS, type AppEdge, type AppNode, type ImageAsset, type ImageGenerationData, type NodeData, type NodeKind } from '../../shared/graph/types';
import { ApiError, OfflineError, api, errorText } from '../lib/api';
import { uploadDataUrl } from '../lib/images';
import type { Template } from '../graph/templates';
import { DEFAULT_GALLERY, type GalleryView } from '../lib/gallery';

type Snapshot = { name: string; nodes: AppNode[]; edges: AppEdge[] };

export type Toast = { id: string; text: string; tone: 'info' | 'error' };

export type PickerState = {
  screen: XYPosition;
  flow: XYPosition;
  /** Present when the picker was opened by dragging out of a port. */
  from?: { nodeId: string; handleId: string; handleType: 'source' | 'target' };
};

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

type BoardState = {
  boardId: string | null;
  /** Server revision the canvas was last saved as. */
  revision: number;
  boards: BoardSummary[];
  /** The workflow gallery (sidebar expanded over the screen) and its search, filter and sort. */
  galleryOpen: boolean;
  gallery: GalleryView;
  profile: Profile;
  /** Which image provider the server is using. */
  provider: { id: string; label: string } | null;
  name: string;
  nodes: AppNode[];
  edges: AppEdge[];
  past: Snapshot[];
  future: Snapshot[];
  lastCommit: { key: string; at: number } | null;
  clipboard: { nodes: AppNode[]; edges: AppEdge[] } | null;
  activity: NodeExecutionView[];
  /** Estimated spend, from BoardRunState. */
  spend: BoardRunState['spend'];
  activeRunId: string | null;
  running: boolean;
  loaded: boolean;
  offline: boolean;
  showStart: boolean;
  templatesOpen: boolean;
  settingsOpen: boolean;
  busy: string | null;
  saveState: SaveState;
  saveError: string | null;
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
  loadTemplate: (t: Template) => Promise<void>;
  newBlank: () => Promise<void>;
  openBoard: (id: string) => Promise<void>;
  refreshBoards: () => Promise<void>;
  setGalleryOpen: (v: boolean) => void;
  setGallery: (patch: Partial<GalleryView>) => void;
  toggleFavorite: (id: string) => Promise<void>;
  duplicateBoard: (id: string) => Promise<void>;
  renameBoard: (id: string, name: string) => Promise<void>;
  removeBoard: (id: string) => Promise<void>;
  setProfile: (p: Profile) => void;
  setShowStart: (v: boolean) => void;
  setTemplatesOpen: (v: boolean) => void;
  setSettingsOpen: (v: boolean) => void;
  /** Re-reads which provider the server uses, after the key changes. */
  setProvider: (p: { id: string; label: string }) => void;
  setPicker: (p: PickerState | null) => void;
  notify: (text: string, tone?: Toast['tone']) => void;
  init: () => Promise<void>;
  /** Saves now if the board changed since the last save. */
  save: () => Promise<void>;
};

const HISTORY_LIMIT = 100;
const LAST_BOARD_KEY = 'nodetrain:lastBoardId';
const LEGACY_IDB_KEY = 'nodetrain:board:v1';

const strip = (n: AppNode): AppNode => {
  const { selected: _s, dragging: _d, measured: _m, ...rest } = n;
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
    for (const f of RUN_FIELDS) if (f !== 'selectedOutputId') data[f] = cur.data[f];
    return { ...n, data } as AppNode;
  });
}

/** Rebuilds what the canvas shows about runs from the server's run history. */
function hydrate(nodes: AppNode[], state: BoardRunState): AppNode[] {
  return nodes.map((n) => {
    if (n.type !== 'imageGeneration') return n;
    const latest = state.latest[n.id];
    const ok = state.lastSucceeded[n.id];
    const outputs = state.outputs[n.id] ?? [];
    let status: ImageGenerationData['status'] = outputs.length ? 'succeeded' : 'idle';
    if (latest?.status === 'queued' || latest?.status === 'running') status = latest.status;
    else if (latest?.status === 'failed') status = 'failed';
    return {
      ...n,
      data: {
        ...n.data,
        outputs,
        status,
        error: latest?.status === 'failed' ? latest.error : undefined,
        lastRunKey: ok?.runKey,
        lastRunAt: ok?.endedAt,
      },
    } as AppNode;
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Autosave bookkeeping lives outside React state.
let lastSavedJson = '';
let saving: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let pollToken = 0;
let initStarted = false;

export const useBoard = create<BoardState>((set, get) => {
  const docJson = () => {
    const s = get();
    return JSON.stringify({ name: s.name, doc: toDocument(s.nodes, s.edges) });
  };

  /** Saves the board if it changed. Concurrent callers share one request. */
  const saveNow = async (): Promise<void> => {
    if (saving) {
      await saving;
      return saveNow();
    }
    const s = get();
    if (!s.boardId || !s.loaded) return;
    const json = docJson();
    if (json === lastSavedJson) {
      if (s.saveState === 'saving') set({ saveState: 'saved' });
      return;
    }
    set({ saveState: 'saving' });
    saving = (async () => {
      try {
        const saved = await api.saveBoard(s.boardId!, { name: s.name, baseRevision: s.revision, document: toDocument(s.nodes, s.edges) });
        lastSavedJson = json;
        set({ revision: saved.revision, saveState: docJson() === json ? 'saved' : 'saving', saveError: null, offline: false });
      } catch (err) {
        set({ saveState: 'error', saveError: errorText(err), offline: err instanceof OfflineError });
        throw err;
      } finally {
        saving = null;
      }
    })();
    await saving;
    if (docJson() !== lastSavedJson) return saveNow();
  };

  const patchNode = (id: string, patch: Partial<ImageGenerationData>) =>
    set({ nodes: get().nodes.map((n) => (n.id === id && n.type === 'imageGeneration' ? ({ ...n, data: { ...n.data, ...patch } } as AppNode) : n)) });

  /** Copies a run's progress onto the canvas. */
  const applyRun = (run: RunView) => {
    for (const ex of run.nodes) {
      const n = get().nodes.find((x) => x.id === ex.nodeId);
      if (!n || n.type !== 'imageGeneration') continue;
      if (ex.status === 'queued' || ex.status === 'running') patchNode(ex.nodeId, { status: ex.status, error: undefined });
      else if (ex.status === 'succeeded') {
        const known = new Set(n.data.outputs.map((o) => o.id));
        const fresh = ex.outputs.filter((o) => !known.has(o.id));
        // Clearing the selection shows the newest output, the same rule the server uses.
        patchNode(ex.nodeId, {
          status: 'succeeded',
          error: undefined,
          outputs: [...fresh, ...n.data.outputs],
          ...(fresh.length ? { selectedOutputId: undefined } : {}),
          lastRunKey: ex.runKey,
          lastRunAt: ex.endedAt,
        });
      } else if (ex.status === 'failed') patchNode(ex.nodeId, { status: 'failed', error: ex.error });
      else patchNode(ex.nodeId, { status: n.data.outputs.length ? 'succeeded' : 'idle', error: undefined });
    }
  };

  const poll = async (runId: string) => {
    const token = ++pollToken;
    set({ running: true, activeRunId: runId });
    let failures = 0;
    while (token === pollToken) {
      try {
        const run = await api.getRun(runId);
        if (token !== pollToken) return;
        failures = 0;
        applyRun(run);
        if (run.status !== 'queued' && run.status !== 'running') {
          set({ running: false, activeRunId: null });
          const boardId = get().boardId;
          if (boardId) api.boardState(boardId).then((st) => set({ activity: st.activity, spend: st.spend }), () => {});
          if (run.status === 'canceled') get().notify('Run canceled.');
          return;
        }
      } catch (err) {
        // The server may be restarting; keep trying for a while before giving up.
        if (++failures > 20) {
          set({ running: false, activeRunId: null, offline: err instanceof OfflineError });
          get().notify(errorText(err), 'error');
          return;
        }
      }
      await sleep(700);
    }
  };

  const showBoard = (b: BoardPayload, state: BoardRunState, showStart = false) => {
    const { nodes, edges } = fromDocument(b.document);
    pollToken++;
    set({
      galleryOpen: false,
      boardId: b.id,
      revision: b.revision,
      name: b.name,
      nodes: hydrate(nodes, state),
      edges,
      past: [],
      future: [],
      lastCommit: null,
      activity: state.activity,
      spend: state.spend,
      activeRunId: state.activeRunId,
      running: false,
      showStart: showStart && nodes.length === 0,
      saveState: 'saved',
      saveError: null,
      offline: false,
      fitNonce: get().fitNonce + 1,
    });
    lastSavedJson = docJson();
    localStorage.setItem(LAST_BOARD_KEY, b.id);
    if (state.activeRunId) void poll(state.activeRunId);
  };

  /** One-time import of a board saved by the step 1 prototype in this browser. */
  const importLegacyBoard = async (): Promise<BoardPayload | null> => {
    const legacy = await idbGet<{ name: string; nodes: AppNode[]; edges: AppEdge[] }>(LEGACY_IDB_KEY).catch(() => undefined);
    if (!legacy?.nodes?.length) return null;
    const nodes = await Promise.all(
      legacy.nodes.map(async (n) => {
        if (n.type !== 'imageInput') return n;
        const images: ImageAsset[] = [];
        for (const img of n.data.images) {
          if (img.src.startsWith('data:')) images.push(await uploadDataUrl(img.src, img.name));
        }
        return { ...n, data: { ...n.data, images } } as AppNode;
      }),
    );
    const board = await api.createBoard(legacy.name, migrateDocument({ nodes, edges: legacy.edges }));
    await idbDel(LEGACY_IDB_KEY);
    return board;
  };

  return {
    boardId: null,
    revision: 0,
    boards: [],
    galleryOpen: false,
    gallery: DEFAULT_GALLERY,
    profile: { name: '', picture: null },
    provider: null,
    name: 'Untitled workflow',
    nodes: [],
    edges: [],
    past: [],
    future: [],
    lastCommit: null,
    clipboard: null,
    activity: [],
    spend: { board: 0, today: 0 },
    activeRunId: null,
    running: false,
    loaded: false,
    offline: false,
    showStart: false,
    templatesOpen: false,
    settingsOpen: false,
    busy: null,
    saveState: 'idle',
    saveError: null,
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
      set({ past: s.past.slice(0, -1), future: [snapshot(s), ...s.future], name: prev.name, nodes: keepRunState(prev.nodes, s.nodes), edges: prev.edges, lastCommit: null });
    },

    redo: () => {
      const s = get();
      const next = s.future[0];
      if (!next) return;
      set({ future: s.future.slice(1), past: [...s.past, snapshot(s)], name: next.name, nodes: keepRunState(next.nodes, s.nodes), edges: next.edges, lastCommit: null });
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
      set({ edges: [...s.edges, { id: nanoid(8), source: c.source!, target: c.target!, sourceHandle: c.sourceHandle ?? null, targetHandle: c.targetHandle ?? null }] });
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
      set({ nodes: [...s.nodes.map((n) => (n.selected ? { ...n, selected: false } : n)), newNode], edges: newEdge ? [...s.edges, newEdge] : s.edges, showStart: false });
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
        // A pasted generation node starts fresh: run history belongs to the original.
        const data = n.type === 'imageGeneration' ? { ...n.data, status: 'idle', outputs: [], selectedOutputId: undefined, lastRunKey: undefined, lastRunAt: undefined, error: undefined } : n.data;
        return { ...n, id, data, selected: true, position: { x: n.position.x + 48, y: n.position.y + 48 } } as AppNode;
      });
      const edges = s.clipboard.edges.map((e) => ({ ...e, id: nanoid(8), source: map.get(e.source)!, target: map.get(e.target)! }));
      s.commit();
      set({ nodes: [...s.nodes.map((n) => ({ ...n, selected: false })), ...nodes], edges: [...s.edges, ...edges], clipboard: { nodes: nodes.map(strip), edges } });
    },

    duplicateSelection: () => {
      get().copySelection();
      get().paste();
    },

    deleteSelection: () => {
      const s = get();
      const ids = new Set(s.nodes.filter((n) => n.selected).map((n) => n.id));
      if (!ids.size && !s.edges.some((e) => e.selected)) return;
      s.commit();
      set({ nodes: s.nodes.filter((n) => !ids.has(n.id)), edges: s.edges.filter((e) => !e.selected && !ids.has(e.source) && !ids.has(e.target)) });
    },

    run: async (targetId) => {
      const s = get();
      if (s.running || !s.boardId) return;
      if (!planRun(s.nodes, s.edges, targetId).length) {
        s.notify('Add an Image Generation node to run this workflow.');
        return;
      }
      set({ running: true });
      try {
        clearTimeout(saveTimer);
        await saveNow(); // Runs use the saved revision, so save first.
        const run = await api.startRun(get().boardId!, get().revision, targetId);
        applyRun(run);
        void poll(run.id);
      } catch (err) {
        set({ running: false });
        get().notify(errorText(err), 'error');
      }
    },

    cancelRun: () => {
      const id = get().activeRunId;
      if (id) api.cancelRun(id).catch((err) => get().notify(errorText(err), 'error'));
    },

    selectOutput: (nodeId, outputId) => {
      get().commit();
      set({ nodes: get().nodes.map((n) => (n.id === nodeId && n.type === 'imageGeneration' ? ({ ...n, data: { ...n.data, selectedOutputId: outputId } } as AppNode) : n)) });
    },

    loadTemplate: async (t) => {
      set({ busy: `Setting up ${t.name}…` });
      try {
        await saveNow().catch(() => {});
        const built = await t.build();
        const cur = get();
        const doc = toDocument(built.nodes, built.edges);
        // An untouched empty board is reused rather than left behind.
        const board =
          cur.boardId && cur.nodes.length === 0
            ? await api.saveBoard(cur.boardId, { name: built.name, baseRevision: cur.revision, document: doc })
            : await api.createBoard(built.name, doc);
        showBoard(board, { outputs: {}, latest: {}, lastSucceeded: {}, activeRunId: null, activity: [], spend: { board: 0, today: 0 } });
        set({ templatesOpen: false });
        void get().refreshBoards();
      } catch (err) {
        get().notify(errorText(err), 'error');
      } finally {
        set({ busy: null });
      }
    },

    newBlank: async () => {
      try {
        await saveNow().catch(() => {});
        if (get().boardId && get().nodes.length === 0) {
          set({ showStart: true, galleryOpen: false });
          return;
        }
        const board = await api.createBoard('Untitled workflow');
        showBoard(board, { outputs: {}, latest: {}, lastSucceeded: {}, activeRunId: null, activity: [], spend: { board: 0, today: 0 } }, true);
        void get().refreshBoards();
      } catch (err) {
        get().notify(errorText(err), 'error');
      }
    },

    openBoard: async (id) => {
      if (id === get().boardId) return;
      try {
        await saveNow().catch(() => {});
        const [board, state] = await Promise.all([api.getBoard(id), api.boardState(id)]);
        showBoard(board, state);
      } catch (err) {
        get().notify(errorText(err), 'error');
      }
    },

    refreshBoards: async () => {
      try {
        set({ boards: await api.listBoards() });
      } catch {
        /* the offline banner covers this */
      }
    },

    setGalleryOpen: (v) => {
      set({ galleryOpen: v });
      if (v) void get().refreshBoards();
    },
    setGallery: (patch) => set({ gallery: { ...get().gallery, ...patch } }),

    toggleFavorite: async (id) => {
      const b = get().boards.find((x) => x.id === id);
      if (!b) return;
      const favorite = !b.favorite;
      set({ boards: get().boards.map((x) => (x.id === id ? { ...x, favorite } : x)) });
      try {
        await api.setFavorite(id, favorite);
      } catch (err) {
        set({ boards: get().boards.map((x) => (x.id === id ? { ...x, favorite: !favorite } : x)) });
        get().notify(errorText(err), 'error');
      }
    },

    duplicateBoard: async (id) => {
      try {
        if (id === get().boardId) await saveNow().catch(() => {});
        const copy = await api.duplicateBoard(id);
        await get().refreshBoards();
        get().notify(`Created “${copy.name}”.`);
      } catch (err) {
        get().notify(errorText(err), 'error');
      }
    },

    renameBoard: async (id, raw) => {
      const name = raw.trim();
      if (!name) return;
      try {
        if (id === get().boardId) {
          get().setName(name);
          await saveNow();
        } else {
          const b = await api.getBoard(id);
          await api.saveBoard(id, { name, baseRevision: b.revision, document: b.document });
        }
        await get().refreshBoards();
      } catch (err) {
        get().notify(errorText(err), 'error');
      }
    },

    removeBoard: async (id) => {
      try {
        if (id === get().boardId) {
          clearTimeout(saveTimer);
          pollToken++;
        }
        await api.deleteBoard(id);
        if (id === get().boardId) {
          // No workflow open any more: back to the gallery.
          lastSavedJson = '';
          localStorage.removeItem(LAST_BOARD_KEY);
          set({ boardId: null, nodes: [], edges: [], past: [], future: [], activity: [], running: false, activeRunId: null, showStart: false, galleryOpen: true, name: 'Untitled workflow', saveState: 'idle' });
        }
        await get().refreshBoards();
        get().notify('Workflow removed.');
      } catch (err) {
        get().notify(errorText(err), 'error');
      }
    },

    setProfile: (profile) => set({ profile }),

    setShowStart: (v) => set({ showStart: v }),
    setTemplatesOpen: (v) => set({ templatesOpen: v }),
    setSettingsOpen: (v) => set({ settingsOpen: v }),
    setProvider: (p) => set({ provider: p }),
    setPicker: (p) => set({ picker: p }),

    notify: (text, tone = 'info') => {
      const toast = { id: nanoid(6), text, tone };
      set({ toast });
      setTimeout(() => {
        if (get().toast?.id === toast.id) set({ toast: null });
      }, 4200);
    },

    save: saveNow,

    init: async () => {
      // React StrictMode mounts twice in development; only initialise once.
      if (initStarted && !get().offline) return;
      initStarted = true;
      try {
        const health = await api.health();
        set({ provider: { id: health.provider.id, label: health.provider.label } });
        void api.profile().then((profile) => set({ profile }), () => {});
        let board: BoardPayload | null = null;
        const lastId = localStorage.getItem(LAST_BOARD_KEY);
        if (lastId) board = await api.getBoard(lastId).catch((e) => (e instanceof ApiError && e.status === 404 ? null : Promise.reject(e)));
        const boards = await api.listBoards();
        if (!board && boards.length) board = await api.getBoard(boards[0].id);
        if (!board) board = await importLegacyBoard();
        if (!board) {
          // First launch: nothing to open yet, so show the gallery's empty state.
          set({ loaded: true, boards, galleryOpen: true });
          return;
        }
        const fresh = false;
        const state = await api.boardState(board.id);
        set({ loaded: true });
        showBoard(board, state, fresh || board.document.nodes.length === 0);
        void get().refreshBoards();
      } catch (err) {
        set({ loaded: true, offline: err instanceof OfflineError, saveState: 'error', saveError: errorText(err) });
      }
    },
  };
});

// ---------- Autosave ----------

useBoard.subscribe((s, prev) => {
  if (!s.loaded || !s.boardId || s.boardId !== prev.boardId) return;
  if (s.nodes === prev.nodes && s.edges === prev.edges && s.name === prev.name) return;
  clearTimeout(saveTimer);
  // Selection and drag flags never reach the server: save() compares the saved document.
  saveTimer = setTimeout(() => void useBoard.getState().save().catch(() => {}), 600);
});

export function exportWorkflow() {
  const { name, nodes, edges } = useBoard.getState();
  const doc = { ...toDocument(nodes, edges), name, exportedAt: new Date().toISOString() };
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name.replace(/[^\w-]+/g, '-').toLowerCase() || 'workflow'}.nodetrain.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
