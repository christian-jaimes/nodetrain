import { CATALOG } from './catalog';
import { RETIRED_MODELS } from './models';
import { RUN_FIELDS, type AppEdge, type AppNode, type NodeKind } from './types';

/**
 * The saved form of a workflow graph. Bump DOC_VERSION when the shape
 * changes and add a step to `migrateDocument` so old boards keep opening.
 */
export const DOC_FORMAT = 'nodetrain.board';
export const DOC_VERSION = 1;

/** Per node type schema versions. Bump when a node's data shape changes. */
export const NODE_TYPE_VERSIONS: Record<NodeKind, number> = {
  prompt: 1,
  imageInput: 1,
  imageGeneration: 2,
};

/**
 * Per node type upgrades, keyed by the version they upgrade from.
 * imageGeneration v1 -> v2: retired models are replaced (gpt-image-1 shut down 2026-10-23).
 */
const NODE_MIGRATIONS: Partial<Record<NodeKind, Record<number, (data: Record<string, unknown>) => Record<string, unknown>>>> = {
  imageGeneration: {
    1: (d) => (typeof d.model === 'string' && RETIRED_MODELS[d.model] ? { ...d, model: RETIRED_MODELS[d.model] } : d),
  },
};

function upgradeNode(type: NodeKind, version: number, data: Record<string, unknown>) {
  const target = NODE_TYPE_VERSIONS[type] ?? version;
  let v = version;
  let d = data;
  while (v < target) {
    const step = NODE_MIGRATIONS[type]?.[v];
    if (step) d = step(d);
    v++;
  }
  return { typeVersion: Math.max(v, version), data: d };
}

export type SavedNode = {
  id: string;
  type: NodeKind;
  typeVersion: number;
  position: { x: number; y: number };
  data: Record<string, unknown>;
};

export type SavedEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle: string | null;
  targetHandle: string | null;
};

export type BoardDocument = {
  format: typeof DOC_FORMAT;
  version: number;
  nodes: SavedNode[];
  edges: SavedEdge[];
};

/** Run results live in run history on the server, not in the board. */
const RUNTIME_ONLY = RUN_FIELDS.filter((f) => f !== 'selectedOutputId');

export function toDocument(nodes: AppNode[], edges: AppEdge[]): BoardDocument {
  return {
    format: DOC_FORMAT,
    version: DOC_VERSION,
    nodes: nodes.map((n) => {
      const data = { ...(n.data as Record<string, unknown>) };
      if (n.type === 'imageGeneration') for (const f of RUNTIME_ONLY) delete data[f];
      return {
        id: n.id,
        type: n.type as NodeKind,
        typeVersion: NODE_TYPE_VERSIONS[n.type as NodeKind],
        position: { x: Math.round(n.position.x), y: Math.round(n.position.y) },
        data,
      };
    }),
    edges: edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      sourceHandle: e.sourceHandle ?? null,
      targetHandle: e.targetHandle ?? null,
    })),
  };
}

/** Turns a saved document back into canvas nodes, filling any missing fields with defaults. */
export function fromDocument(doc: BoardDocument): { nodes: AppNode[]; edges: AppEdge[] } {
  const nodes = doc.nodes
    .filter((n) => n.type in CATALOG)
    .map((n) => {
      const defaults = CATALOG[n.type].create() as Record<string, unknown>;
      return { id: n.id, type: n.type, position: n.position, data: { ...defaults, ...n.data } } as AppNode;
    });
  const ids = new Set(nodes.map((n) => n.id));
  const edges = doc.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
  return { nodes, edges };
}

export class DocumentError extends Error {}

/** Accepts any known historical shape and returns the current one. */
export function migrateDocument(input: unknown): BoardDocument {
  if (!input || typeof input !== 'object') throw new DocumentError('Board document is empty or not an object.');
  const raw = input as Record<string, unknown>;
  const version = typeof raw.version === 'number' ? raw.version : 0;
  if (version > DOC_VERSION) throw new DocumentError(`This board was saved by a newer NodeTrain (format v${version}). Update the app to open it.`);
  if (!Array.isArray(raw.nodes) || !Array.isArray(raw.edges)) throw new DocumentError('Board document needs nodes and edges arrays.');

  let nodes = raw.nodes as Record<string, unknown>[];
  const edges = raw.edges as Record<string, unknown>[];

  if (version === 0) {
    // v0: the step 1 prototype saved React Flow nodes as-is, with run results inline.
    nodes = nodes.map((n) => {
      const data = { ...((n.data as Record<string, unknown>) ?? {}) };
      for (const f of RUNTIME_ONLY) delete data[f];
      return { ...n, typeVersion: 1, data };
    });
  }

  for (const n of nodes) {
    if (typeof n.id !== 'string' || typeof n.type !== 'string') throw new DocumentError('Every node needs an id and a type.');
    const p = n.position as { x?: unknown; y?: unknown } | undefined;
    if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') throw new DocumentError(`Node ${n.id} has no position.`);
  }
  for (const e of edges) {
    if (typeof e.id !== 'string' || typeof e.source !== 'string' || typeof e.target !== 'string') throw new DocumentError('Every edge needs an id, source and target.');
  }

  return {
    format: DOC_FORMAT,
    version: DOC_VERSION,
    nodes: nodes.map((n) => {
      const up = upgradeNode(n.type as NodeKind, (n.typeVersion as number) ?? 1, (n.data as Record<string, unknown>) ?? {});
      return {
        id: n.id as string,
        type: n.type as NodeKind,
        typeVersion: up.typeVersion,
        position: { x: (n.position as { x: number }).x, y: (n.position as { y: number }).y },
        data: up.data,
      };
    }),
    edges: edges.map((e) => ({
      id: e.id as string,
      source: e.source as string,
      target: e.target as string,
      sourceHandle: (e.sourceHandle as string | null) ?? null,
      targetHandle: (e.targetHandle as string | null) ?? null,
    })),
  };
}
