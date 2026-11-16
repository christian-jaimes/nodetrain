import { CATALOG, PORT_TYPE_LABEL, getPort } from './catalog';
import type { AppEdge, AppNode, ImageAsset, ImageGenerationNode, NodeKind } from './types';

export type ConnectionLike = {
  source: string | null;
  target: string | null;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};

export type CheckResult = { ok: true } | { ok: false; reason: string };

/** True if `from` can reach `to` by following edges downstream. */
function reaches(edges: AppEdge[], from: string, to: string): boolean {
  const seen = new Set<string>();
  const stack = [from];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === to) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const e of edges) if (e.source === id) stack.push(e.target);
  }
  return false;
}

export function checkConnection(nodes: AppNode[], edges: AppEdge[], c: ConnectionLike): CheckResult {
  if (!c.source || !c.target) return { ok: false, reason: 'Connection is incomplete.' };
  if (c.source === c.target) return { ok: false, reason: 'A node cannot connect to itself.' };
  const src = nodes.find((n) => n.id === c.source);
  const tgt = nodes.find((n) => n.id === c.target);
  if (!src || !tgt) return { ok: false, reason: 'Node not found.' };
  const out = getPort(src.type as NodeKind, 'source', c.sourceHandle);
  const inp = getPort(tgt.type as NodeKind, 'target', c.targetHandle);
  if (!out) return { ok: false, reason: 'Connect from an output port.' };
  if (!inp) return { ok: false, reason: `${CATALOG[tgt.type as NodeKind].label} has no matching input.` };
  if (out.type !== inp.type) {
    return {
      ok: false,
      reason: `${PORT_TYPE_LABEL[out.type]} can't connect to ${inp.label} (expects ${PORT_TYPE_LABEL[inp.type]}).`,
    };
  }
  const duplicate = edges.some(
    (e) => e.source === c.source && e.target === c.target && e.sourceHandle === c.sourceHandle && e.targetHandle === c.targetHandle,
  );
  if (duplicate) return { ok: false, reason: 'These ports are already connected.' };
  if (reaches(edges, c.target, c.source)) return { ok: false, reason: 'That would create a loop. Workflows must flow one way.' };
  return { ok: true };
}

/** Inputs of `kind` that accept `type`, for drag-to-create. */
export function compatibleInputs(kind: NodeKind, type: 'text' | 'image') {
  return CATALOG[kind].inputs.filter((p) => p.type === type);
}

// ---------- Resolving inputs ----------

export type ResolvedInputs = {
  promptParts: { from: string; text: string }[];
  prompt: string;
  references: ImageAsset[];
};

export function selectedOutput(n: ImageGenerationNode): ImageAsset | undefined {
  const d = n.data;
  return d.outputs.find((o) => o.id === d.selectedOutputId) ?? d.outputs[0];
}

function incoming(edges: AppEdge[], nodeId: string, handle: string) {
  return edges.filter((e) => e.target === nodeId && e.targetHandle === handle);
}

export function resolveInputs(node: ImageGenerationNode, nodes: AppNode[], edges: AppEdge[]): ResolvedInputs {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const promptParts: ResolvedInputs['promptParts'] = [];
  for (const e of incoming(edges, node.id, 'prompt')) {
    const src = byId.get(e.source);
    if (src?.type === 'prompt' && src.data.text.trim()) promptParts.push({ from: src.data.title, text: src.data.text.trim() });
  }
  if (node.data.prompt.trim()) promptParts.push({ from: 'This node', text: node.data.prompt.trim() });

  const references: ImageAsset[] = [];
  for (const e of incoming(edges, node.id, 'references')) {
    const src = byId.get(e.source);
    if (src?.type === 'imageInput') references.push(...src.data.images);
    if (src?.type === 'imageGeneration') {
      const img = selectedOutput(src);
      if (img) references.push(img);
    }
  }
  return { promptParts, prompt: promptParts.map((p) => p.text).join('\n\n'), references };
}

/** Fingerprint used to tell whether an output is out of date. */
export function runKey(node: ImageGenerationNode, nodes: AppNode[], edges: AppEdge[]): string {
  const r = resolveInputs(node, nodes, edges);
  const d = node.data;
  return JSON.stringify([r.prompt, r.references.map((i) => i.id), d.model, d.aspectRatio, d.quality]);
}

export function isStale(node: ImageGenerationNode, nodes: AppNode[], edges: AppEdge[]): boolean {
  if (!node.data.lastRunKey || node.data.outputs.length === 0) return false;
  return node.data.lastRunKey !== runKey(node, nodes, edges);
}

export type Issue = { nodeId: string; message: string; detail: string };

export function validateNode(node: AppNode, nodes: AppNode[], edges: AppEdge[]): Issue[] {
  if (node.type !== 'imageGeneration') return [];
  const r = resolveInputs(node, nodes, edges);
  const issues: Issue[] = [];
  if (!r.prompt) issues.push({ nodeId: node.id, message: `${node.data.title}: needs a prompt.`, detail: 'Needs a prompt. Write one in the node or connect a Prompt node.' });
  if (r.references.length > 16) issues.push({ nodeId: node.id, message: `${node.data.title}: too many reference images.`, detail: 'Too many reference images (max 16).' });
  return issues;
}

export function validateGraph(nodes: AppNode[], edges: AppEdge[]): Issue[] {
  return nodes.flatMap((n) => validateNode(n, nodes, edges));
}

/**
 * Generation nodes that must run to produce `targetId` (or every generation
 * node when targetId is omitted), in dependency order.
 */
export function planRun(nodes: AppNode[], edges: AppEdge[], targetId?: string): string[] {
  const gen = new Set(nodes.filter((n) => n.type === 'imageGeneration').map((n) => n.id));
  let wanted: Set<string>;
  if (targetId) {
    wanted = new Set();
    const stack = [targetId];
    while (stack.length) {
      const id = stack.pop()!;
      if (wanted.has(id)) continue;
      wanted.add(id);
      for (const e of edges) if (e.target === id) stack.push(e.source);
    }
  } else {
    wanted = new Set(nodes.map((n) => n.id));
  }
  // Kahn's algorithm over the wanted subgraph.
  const sub = edges.filter((e) => wanted.has(e.source) && wanted.has(e.target));
  const indeg = new Map([...wanted].map((id) => [id, 0]));
  for (const e of sub) indeg.set(e.target, (indeg.get(e.target) ?? 0) + 1);
  const queue = [...wanted].filter((id) => indeg.get(id) === 0);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const e of sub) {
      if (e.source !== id) continue;
      const d = indeg.get(e.target)! - 1;
      indeg.set(e.target, d);
      if (d === 0) queue.push(e.target);
    }
  }
  return order.filter((id) => gen.has(id));
}
