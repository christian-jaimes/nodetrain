import { describe, expect, it } from 'vitest';
import { CATALOG } from '../shared/graph/catalog';
import { DOC_VERSION, fromDocument, migrateDocument, toDocument } from '../shared/graph/document';
import type { AppEdge, AppNode, ImageAsset, ImageGenerationNode, NodeKind } from '../shared/graph/types';
import { checkConnection, isStale, planRun, resolveInputs, runKey, validateGraph } from '../shared/graph/validate';

const node = (id: string, kind: NodeKind, patch: Record<string, unknown> = {}): AppNode =>
  ({ id, type: kind, position: { x: 0, y: 0 }, data: { ...CATALOG[kind].create(), ...patch } }) as AppNode;
const edge = (source: string, target: string, sourceHandle: string, targetHandle: string): AppEdge => ({ id: `${source}-${target}-${targetHandle}`, source, target, sourceHandle, targetHandle });
const img = (id: string): ImageAsset => ({ id, src: `/api/artifacts/${id}`, name: id, width: 10, height: 10, createdAt: 0 });

describe('checkConnection', () => {
  const nodes = [node('p', 'prompt'), node('i', 'imageInput'), node('g1', 'imageGeneration'), node('g2', 'imageGeneration')];

  it('accepts matching types', () => {
    expect(checkConnection(nodes, [], { source: 'p', sourceHandle: 'text', target: 'g1', targetHandle: 'prompt' }).ok).toBe(true);
    expect(checkConnection(nodes, [], { source: 'i', sourceHandle: 'image', target: 'g1', targetHandle: 'references' }).ok).toBe(true);
  });

  it('rejects mismatched types with a reason', () => {
    const r = checkConnection(nodes, [], { source: 'p', sourceHandle: 'text', target: 'g1', targetHandle: 'references' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Text can't connect to References/);
  });

  it('rejects self connections, duplicates and loops', () => {
    expect(checkConnection(nodes, [], { source: 'g1', sourceHandle: 'image', target: 'g1', targetHandle: 'references' }).ok).toBe(false);
    const e = [edge('g1', 'g2', 'image', 'references')];
    expect(checkConnection(nodes, e, { source: 'g1', sourceHandle: 'image', target: 'g2', targetHandle: 'references' }).ok).toBe(false);
    const loop = checkConnection(nodes, e, { source: 'g2', sourceHandle: 'image', target: 'g1', targetHandle: 'references' });
    expect(loop.ok).toBe(false);
    if (!loop.ok) expect(loop.reason).toMatch(/loop/);
  });
});

describe('planRun', () => {
  // p -> g1 -> g2 -> g3, and an unrelated g4
  const nodes = [node('p', 'prompt'), node('g1', 'imageGeneration'), node('g2', 'imageGeneration'), node('g3', 'imageGeneration'), node('g4', 'imageGeneration')];
  const edges = [edge('p', 'g1', 'text', 'prompt'), edge('g1', 'g2', 'image', 'references'), edge('g2', 'g3', 'image', 'references')];

  it('orders every generation node by dependency', () => {
    const order = planRun(nodes, edges);
    expect(order).toHaveLength(4);
    expect(order.indexOf('g1')).toBeLessThan(order.indexOf('g2'));
    expect(order.indexOf('g2')).toBeLessThan(order.indexOf('g3'));
  });

  it('runs only what a target needs', () => {
    expect(planRun(nodes, edges, 'g2')).toEqual(['g1', 'g2']);
    expect(planRun(nodes, edges, 'g4')).toEqual(['g4']);
  });
});

describe('inputs, validation and staleness', () => {
  it('joins connected prompts in edge order, then the inline prompt', () => {
    const nodes = [node('a', 'prompt', { title: 'Style', text: 'Cinematic.' }), node('b', 'prompt', { text: 'Wide shot.' }), node('g', 'imageGeneration', { prompt: 'A lighthouse.' })];
    const edges = [edge('a', 'g', 'text', 'prompt'), edge('b', 'g', 'text', 'prompt')];
    const r = resolveInputs(nodes[2] as ImageGenerationNode, nodes, edges);
    expect(r.prompt).toBe('Cinematic.\n\nWide shot.\n\nA lighthouse.');
    expect(r.promptParts[0].from).toBe('Style');
  });

  it('flags a generation node with no prompt', () => {
    const issues = validateGraph([node('g', 'imageGeneration', { title: 'Hero' })], []);
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/Hero: needs a prompt/);
  });

  it('marks output stale when an input changes', () => {
    const p = node('p', 'prompt', { text: 'One' });
    const g = node('g', 'imageGeneration', { outputs: [img('x')] }) as ImageGenerationNode;
    const edges = [edge('p', 'g', 'text', 'prompt')];
    g.data.lastRunKey = runKey(g, [p, g], edges);
    expect(isStale(g, [p, g], edges)).toBe(false);
    const p2 = { ...p, data: { ...p.data, text: 'Two' } } as AppNode;
    expect(isStale(g, [p2, g], edges)).toBe(true);
  });

  it('passes the selected upstream output as a reference', () => {
    const g1 = node('g1', 'imageGeneration', { outputs: [img('new'), img('old')], selectedOutputId: 'old' });
    const g2 = node('g2', 'imageGeneration', { prompt: 'x' }) as ImageGenerationNode;
    const r = resolveInputs(g2, [g1, g2], [edge('g1', 'g2', 'image', 'references')]);
    expect(r.references.map((i) => i.id)).toEqual(['old']);
  });
});

describe('board documents', () => {
  it('round-trips and drops run results but keeps the chosen output', () => {
    const g = node('g', 'imageGeneration', { prompt: 'x', status: 'succeeded', outputs: [img('a')], selectedOutputId: 'a', lastRunKey: 'k' });
    const doc = toDocument([g], []);
    expect(doc.version).toBe(DOC_VERSION);
    expect(doc.nodes[0].data).not.toHaveProperty('outputs');
    expect(doc.nodes[0].data).not.toHaveProperty('status');
    expect(doc.nodes[0].data.selectedOutputId).toBe('a');
    const back = fromDocument(migrateDocument(JSON.parse(JSON.stringify(doc))));
    expect(back.nodes[0].data).toMatchObject({ prompt: 'x', outputs: [], status: 'idle' });
  });

  it('migrates a step 1 (v0) board', () => {
    const v0 = { nodes: [{ id: 'g', type: 'imageGeneration', position: { x: 1, y: 2 }, data: { title: 'G', prompt: 'p', status: 'running', outputs: [] } }], edges: [] };
    const doc = migrateDocument(v0);
    expect(doc.version).toBe(DOC_VERSION);
    expect(doc.nodes[0].data).not.toHaveProperty('status');
  });

  it('refuses boards from a newer version and malformed input', () => {
    expect(() => migrateDocument({ version: 99, nodes: [], edges: [] })).toThrow(/newer/);
    expect(() => migrateDocument({ version: 1, nodes: [{ id: 'x' }], edges: [] })).toThrow();
    expect(() => migrateDocument(null)).toThrow();
  });

  it('drops edges whose nodes are gone', () => {
    const doc = migrateDocument({ version: 1, nodes: [{ id: 'a', type: 'prompt', position: { x: 0, y: 0 }, data: {} }], edges: [{ id: 'e', source: 'a', target: 'zzz' }] });
    expect(fromDocument(doc).edges).toHaveLength(0);
  });
});
