import { CATALOG, PORT_TYPE_LABEL, getPort } from './catalog';
import { settingsIssues } from './models';
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

/**
 * Works out the link made by dropping node `sourceId` onto node `targetId`: the first output of the dropped node
 * into the first input of the target that accepts its type. When nothing fits, says why.
 */
export function planDrop(nodes: AppNode[], edges: AppEdge[], sourceId: string, targetId: string): { ok: true; connection: ConnectionLike } | { ok: false; reason: string } {
  const src = nodes.find((n) => n.id === sourceId);
  const tgt = nodes.find((n) => n.id === targetId);
  if (!src || !tgt) return { ok: false, reason: 'Node not found.' };
  const out = CATALOG[src.type as NodeKind].outputs[0];
  const inputs = CATALOG[tgt.type as NodeKind].inputs;
  if (!out) return { ok: false, reason: `${src.data.title} has no output to connect.` };
  if (!inputs.length) return { ok: false, reason: `${tgt.data.title} takes no inputs.` };
  let first: CheckResult | null = null;
  for (const inp of inputs) {
    const connection = { source: sourceId, sourceHandle: out.id, target: targetId, targetHandle: inp.id };
    const r = checkConnection(nodes, edges, connection);
    if (r.ok) return { ok: true, connection };
    // Prefer the reason from an input of the right type; a type mismatch on the other port is noise.
    if (!first || inp.type === out.type) first = r;
  }
  return first as { ok: false; reason: string };
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

/** The one output the user picked, if any. */
export function selectedOutput(n: ImageGenerationNode): ImageAsset | undefined {
  const d = n.data;
  return d.selectedOutputId ? d.outputs.find((o) => o.id === d.selectedOutputId) : undefined;
}

export const MAX_REFERENCES = 16;

/** What a generation node passes downstream: the picked output, or with none picked, every output (newest first). */
export function referenceOutputs(n: ImageGenerationNode): ImageAsset[] {
  const sel = selectedOutput(n);
  return sel ? [sel] : n.data.outputs.slice(0, MAX_REFERENCES);
}

function incoming(edges: AppEdge[], nodeId: string, handle: string) {
  return edges.filter((e) => e.target === nodeId && e.targetHandle === handle);
}

/** Looks up the images a generation node currently passes downstream. */
export type OutputLookup = (node: ImageGenerationNode) => ImageAsset[];

/** Written in a prompt, this is replaced at run time by the name of the Image Generation node being run. */
export const TITLE_TOKEN = '<node title>';
const TITLE_TOKEN_RE = /<\s*node[ _-]?title\s*>/gi;

/** Fills every `<node title>` in a prompt with the node's name. */
export function fillTitleToken(text: string, title: string): string {
  return text.replace(TITLE_TOKEN_RE, () => title.trim());
}

export function resolveInputs(node: ImageGenerationNode, nodes: AppNode[], edges: AppEdge[], outputOf: OutputLookup = referenceOutputs): ResolvedInputs {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const promptParts: ResolvedInputs['promptParts'] = [];
  for (const e of incoming(edges, node.id, 'prompt')) {
    const src = byId.get(e.source);
    if (src?.type === 'prompt' && src.data.text.trim()) promptParts.push({ from: src.data.title, text: fillTitleToken(src.data.text.trim(), node.data.title) });
  }
  if (node.data.prompt.trim()) promptParts.push({ from: 'This node', text: fillTitleToken(node.data.prompt.trim(), node.data.title) });

  const references: ImageAsset[] = [];
  for (const e of incoming(edges, node.id, 'references')) {
    const src = byId.get(e.source);
    if (src?.type === 'imageInput') references.push(...src.data.images);
    if (src?.type === 'imageGeneration') {
      references.push(...outputOf(src));
    }
  }
  return { promptParts, prompt: promptParts.map((p) => p.text).join('\n\n'), references };
}

/** Fingerprint used to tell whether an output is out of date. */
export function runKey(node: ImageGenerationNode, nodes: AppNode[], edges: AppEdge[], outputOf: OutputLookup = referenceOutputs): string {
  const r = resolveInputs(node, nodes, edges, outputOf);
  const d = node.data;
  return JSON.stringify([r.prompt, r.references.map((i) => i.id), d.model, d.aspectRatio, d.quality]);
}

export function isStale(node: ImageGenerationNode, nodes: AppNode[], edges: AppEdge[]): boolean {
  if (!node.data.lastRunKey || node.data.outputs.length === 0) return false;
  return node.data.lastRunKey !== runKey(node, nodes, edges);
}

export type Issue = { nodeId: string; message: string; detail: string };

export function validateNode(node: AppNode, nodes: AppNode[], edges: AppEdge[], outputOf: OutputLookup = referenceOutputs): Issue[] {
  if (node.type !== 'imageGeneration') return [];
  const r = resolveInputs(node, nodes, edges, outputOf);
  const issues: Issue[] = [];
  if (!r.prompt) issues.push({ nodeId: node.id, message: `${node.data.title}: needs a prompt.`, detail: 'Needs a prompt. Write one in the node or connect a Prompt node.' });
  for (const detail of settingsIssues(node.data.model, node.data.aspectRatio, node.data.quality)) {
    issues.push({ nodeId: node.id, message: `${node.data.title}: ${detail}`, detail });
  }
  if (r.references.length > MAX_REFERENCES) issues.push({ nodeId: node.id, message: `${node.data.title}: too many reference images.`, detail: `Too many reference images (max ${MAX_REFERENCES}).` });
  return issues;
}

export function validateGraph(nodes: AppNode[], edges: AppEdge[]): Issue[] {
  return nodes.flatMap((n) => validateNode(n, nodes, edges));
}

/**
 * Generation nodes that must run to produce `targetId` (or every generation
 * node when targetId is omitted), in dependency order. With upstream false only
 * the target itself runs, using whatever its inputs last produced.
 */
export function planRun(nodes: AppNode[], edges: AppEdge[], targetId?: string, upstream = true): string[] {
  const gen = new Set(nodes.filter((n) => n.type === 'imageGeneration').map((n) => n.id));
  let wanted: Set<string>;
  if (targetId) {
    wanted = new Set();
    const stack = [targetId];
    while (stack.length) {
      const id = stack.pop()!;
      if (wanted.has(id)) continue;
      wanted.add(id);
      if (upstream) for (const e of edges) if (e.target === id) stack.push(e.source);
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
