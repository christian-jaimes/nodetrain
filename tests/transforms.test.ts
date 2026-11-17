import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BoardPayload, BoardRunState, RunView } from '../shared/api';
import { CATALOG } from '../shared/graph/catalog';
import { toDocument } from '../shared/graph/document';
import { TRANSFORMS, defaultOptions, normalizeOptions, transformIssues } from '../shared/graph/transforms';
import type { AppEdge, AppNode, ImageAsset, NodeKind } from '../shared/graph/types';
import { isStale, planRun, validateNode } from '../shared/graph/validate';
import { createApp } from '../server/app';
import { SimulatedProvider } from '../server/providers/simulated';
import { ProviderError } from '../server/providers/types';
import { applyTransform } from '../server/transforms';

const solid = (w: number, h: number, color: string) => sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();

/** A red square on a white background, 100 x 80. */
async function subject() {
  const square = await solid(40, 30, '#d00');
  return sharp({ create: { width: 100, height: 80, channels: 3, background: '#fff' } })
    .composite([{ input: square, left: 30, top: 25 }])
    .png()
    .toBuffer();
}

const raw = async (buf: Buffer) => {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, w: info.width, h: info.height, px: (x: number, y: number) => [...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4)] };
};
const run = (buf: Buffer, op: string, options = {}) => applyTransform(buf, op, { ...defaultOptions(op), ...options });

describe('transform definitions', () => {
  it('has defaults that pass validation for every operation (except ones that need a choice)', () => {
    for (const t of TRANSFORMS) expect(transformIssues(t.id, defaultOptions(t.id)), t.id).toEqual([]);
  });
  it('clamps and repairs saved options', () => {
    expect(normalizeOptions('upscale', { scale: '9x', detail: 'Crisp' })).toEqual({ scale: '2x', detail: 'Crisp' });
    expect(normalizeOptions('blur', { radius: 9999 })).toEqual({ radius: 50 });
    expect(normalizeOptions('blur', undefined)).toEqual({ radius: 4 });
  });
  it('rejects settings that do nothing', () => {
    expect(transformIssues('resize', { width: 0, height: 0 })).toHaveLength(1);
    expect(transformIssues('rotate', { rotation: 'None', flip: 'None' })).toHaveLength(1);
    expect(transformIssues('nope', {})).toHaveLength(1);
  });
});

describe('transform operations', () => {
  it('removes a plain background but keeps the subject', async () => {
    const out = await run(await subject(), 'removeBackground', { softness: 0 });
    expect(out.mime).toBe('image/png');
    const r = await raw(out.data);
    expect(r.px(2, 2)[3]).toBe(0); // corner: background gone
    expect(r.px(50, 40)[3]).toBe(255); // centre: the subject stays opaque
    expect(r.px(50, 40)[1]).toBe(0);
  });
  it('softens the cut edge without eating the subject', async () => {
    const r = await raw((await run(await subject(), 'removeBackground', { softness: 2 })).data);
    expect(r.px(2, 2)[3]).toBe(0);
    expect(r.px(50, 40)).toEqual([r.px(50, 40)[0], 0, 0, 255]);
    const edge = r.px(30, 40)[3]; // on the border of the subject: partly transparent
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(255);
  });
  it('keeps enclosed pixels that match the background colour', async () => {
    // A red ring (60x60) around a white centre on a white background.
    const ring = await sharp({ create: { width: 60, height: 60, channels: 3, background: '#d00' } })
      .composite([{ input: await solid(30, 30, '#fff'), left: 15, top: 15 }])
      .png()
      .toBuffer();
    const img = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#fff' } }).composite([{ input: ring, left: 20, top: 20 }]).png().toBuffer();
    const r = await raw((await run(img, 'removeBackground', { softness: 0 })).data);
    expect(r.px(2, 2)[3]).toBe(0);
    expect(r.px(50, 50)[3]).toBe(255);
  });
  it('explains when there is no plain background', async () => {
    const noise = await sharp(Buffer.from(Array.from({ length: 64 * 64 * 3 }, (_, i) => (i * 7919) % 256)), { raw: { width: 64, height: 64, channels: 3 } }).png().toBuffer();
    await expect(run(noise, 'removeBackground', { tolerance: 5 })).rejects.toThrow(/No plain background/);
    await expect(run(await solid(40, 40, '#fff'), 'removeBackground')).rejects.toBeInstanceOf(ProviderError);
  });
  it('upscales by the chosen factor and refuses absurd sizes', async () => {
    const m = await sharp((await run(await solid(30, 20, '#369'), 'upscale', { scale: '3x' })).data).metadata();
    expect([m.width, m.height]).toEqual([90, 60]);
    await expect(run(await solid(4000, 4000, '#369'), 'upscale', { scale: '4x' })).rejects.toThrow(/too large/);
  });
  it('resizes, keeping proportions when one side is 0', async () => {
    const buf = await solid(200, 100, '#369');
    const a = await sharp((await run(buf, 'resize', { width: 50, height: 0 })).data).metadata();
    expect([a.width, a.height]).toEqual([50, 25]);
    const b = await sharp((await run(buf, 'resize', { width: 60, height: 60, fit: 'Fill and crop' })).data).metadata();
    expect([b.width, b.height]).toEqual([60, 60]);
    const c = await sharp((await run(buf, 'resize', { width: 60, height: 60, fit: 'Stretch' })).data).metadata();
    expect([c.width, c.height]).toEqual([60, 60]);
  });
  it('crops around the centre to an aspect ratio', async () => {
    const m = await sharp((await run(await solid(200, 100, '#369'), 'crop', { ratio: '1:1' })).data).metadata();
    expect([m.width, m.height]).toEqual([100, 100]);
    const t = await sharp((await run(await solid(100, 200, '#369'), 'crop', { ratio: '16:9' })).data).metadata();
    expect([t.width, t.height]).toEqual([100, 56]);
  });
  it('trims a border', async () => {
    const m = await sharp((await run(await subject(), 'trim')).data).metadata();
    expect([m.width, m.height]).toEqual([40, 30]);
  });
  it('rotates and flips', async () => {
    const m = await sharp((await run(await solid(200, 100, '#369'), 'rotate', { rotation: '90° clockwise' })).data).metadata();
    expect([m.width, m.height]).toEqual([100, 200]);
    // Flipping horizontally moves the red square from the left half to the right half.
    const left = await sharp({ create: { width: 100, height: 50, channels: 3, background: '#fff' } }).composite([{ input: await solid(20, 20, '#d00'), left: 0, top: 10 }]).png().toBuffer();
    const r = await raw((await run(left, 'rotate', { rotation: 'None', flip: 'Horizontal' })).data);
    expect(r.px(95, 20)[1]).toBe(0);
    expect(r.px(5, 20)[1]).toBe(255);
  });
  it('adjusts brightness and contrast without touching transparency', async () => {
    const half = await sharp({ create: { width: 10, height: 10, channels: 4, background: { r: 100, g: 100, b: 100, alpha: 0.5 } } }).png().toBuffer();
    const before = (await raw(half)).px(5, 5);
    const r = await raw((await run(half, 'adjust', { contrast: 50, brightness: 0 })).data);
    expect(r.px(5, 5)[3]).toBe(before[3]);
    expect(r.px(5, 5)[0]).toBeLessThan(before[0]); // above mid-grey, more contrast: darker
    const bright = await raw((await run(await solid(10, 10, '#666'), 'adjust', { brightness: 50 })).data);
    expect(bright.px(5, 5)[0]).toBeGreaterThan(0x66);
  });
  it('makes black and white, blurs and sharpens', async () => {
    const g = await raw((await run(await solid(10, 10, '#d00'), 'grayscale')).data);
    const [r, gr, b] = g.px(5, 5);
    expect(r).toBe(gr);
    expect(gr).toBe(b);
    const edge = await subject();
    const soft = await raw((await run(edge, 'blur', { radius: 3 })).data);
    expect(soft.px(29, 40)[1]).toBeGreaterThan(0); // the edge between red and white is now a gradient
    expect(soft.px(29, 40)[1]).toBeLessThan(255);
    expect((await run(edge, 'sharpen')).mime).toBe('image/png');
  });
  it('applies the photo orientation so edits are not sideways', async () => {
    const tall = await sharp({ create: { width: 40, height: 20, channels: 3, background: '#369' } }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const m = await sharp((await run(tall, 'grayscale')).data).metadata();
    expect([m.width, m.height]).toEqual([20, 40]);
  });
});

// ---------- Graph rules ----------

const node = (id: string, kind: NodeKind, patch: Record<string, unknown> = {}): AppNode => ({ id, type: kind, position: { x: 0, y: 0 }, data: { ...CATALOG[kind].create(), ...patch } }) as AppNode;
const edge = (source: string, target: string, sourceHandle: string, targetHandle: string): AppEdge => ({ id: `${source}-${target}`, source, target, sourceHandle, targetHandle });
const img = (id: string): ImageAsset => ({ id, src: `/${id}`, name: `${id}.png`, width: 10, height: 10, createdAt: 0 });

describe('transform nodes in a graph', () => {
  it('is planned in dependency order, ahead of the generation that uses it', () => {
    const nodes = [node('i', 'imageInput', { images: [img('a')] }), node('t', 'imageTransform'), node('g', 'imageGeneration', { prompt: 'x' })];
    const edges = [edge('i', 't', 'image', 'image'), edge('t', 'g', 'image', 'references')];
    expect(planRun(nodes, edges)).toEqual(['t', 'g']);
    expect(planRun(nodes, edges, 'g')).toEqual(['t', 'g']);
    expect(planRun(nodes, edges, 'g', false)).toEqual(['g']);
  });
  it('needs an image', () => {
    const t = node('t', 'imageTransform');
    expect(validateNode(t, [t], [])[0].detail).toMatch(/Needs an image/);
    const i = node('i', 'imageInput', { images: [img('a')] });
    expect(validateNode(t, [i, t], [edge('i', 't', 'image', 'image')])).toEqual([]);
  });
  it('goes stale when its settings change', () => {
    const i = node('i', 'imageInput', { images: [img('a')] });
    const edges = [edge('i', 't', 'image', 'image')];
    const t = node('t', 'imageTransform', { outputs: [img('o')], status: 'succeeded' });
    const key = JSON.stringify([['a'], 'upscale', normalizeOptions('upscale', undefined)]);
    expect(isStale({ ...t, data: { ...t.data, lastRunKey: key } } as never, [i, t], edges)).toBe(false);
    expect(isStale({ ...t, data: { ...t.data, lastRunKey: key, options: { scale: '4x', detail: 'Balanced' } } } as never, [i, t], edges)).toBe(true);
  });
});

// ---------- Server runs ----------

let dir: string;
let ctx: ReturnType<typeof createApp>;
const json = async <T>(res: Response | Promise<Response>) => (await res).json() as Promise<T>;
const call = (method: string, path: string, body?: unknown) =>
  ctx.app.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const upload = async (data: Buffer, name: string) => (await json<ImageAsset>(ctx.app.request('/api/artifacts', { method: 'POST', headers: { 'x-file-name': name }, body: new Uint8Array(data) })));
const createBoard = (nodes: AppNode[], edges: AppEdge[]) => json<BoardPayload>(call('POST', '/api/boards', { name: 'T', document: toDocument(nodes, edges) }));
async function runToEnd(b: BoardPayload, target?: string) {
  const res = await call('POST', `/api/boards/${b.id}/runs`, { revision: b.revision, targetNodeId: target });
  expect(res.status).toBe(202);
  const started = (await res.json()) as RunView;
  await ctx.runs.idle();
  return json<RunView>(call('GET', `/api/runs/${started.id}`));
}

describe('running transform nodes', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'nodetrain-test-'));
    ctx = createApp({ dataDir: dir, provider: new SimulatedProvider([5, 10]) });
  });
  afterEach(() => {
    ctx?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('edits every input image, feeds the next generation and costs nothing', async () => {
    const a = await upload(await solid(40, 30, '#369'), 'a.png');
    const b2 = await upload(await solid(20, 10, '#936'), 'b.png');
    const nodes = [node('i', 'imageInput', { images: [a, b2] }), node('t', 'imageTransform', { options: { scale: '2x', detail: 'Smooth' } }), node('g', 'imageGeneration', { prompt: 'x' })];
    const board = await createBoard(nodes, [edge('i', 't', 'image', 'image'), edge('t', 'g', 'image', 'references')]);
    const result = await runToEnd(board);
    expect(result.status).toBe('succeeded');
    const [t, g] = result.nodes;
    expect(t.nodeId).toBe('t');
    expect(t.outputs.map((o) => [o.width, o.height])).toEqual([[80, 60], [40, 20]]);
    expect(t.outputs[0].provider).toBe('local');
    expect(t.request?.model).toBe('Upscale 2x');
    expect(t.costUsd).toBeUndefined();
    // The generation received the edited images, not the originals.
    expect(g.request?.referenceIds).toEqual(t.outputs.map((o) => o.id));

    const state = await json<BoardRunState>(call('GET', `/api/boards/${board.id}/state`));
    expect(state.outputs.t).toHaveLength(2);
    expect(state.spend.byNode.t).toBeUndefined();
    expect(state.spend.all.generations).toBe(1); // only the generation counts
  });

  it('shows and passes on only the latest result after settings change', async () => {
    const a = await upload(await solid(40, 30, '#369'), 'a.png');
    const make = (scale: string) => [node('i', 'imageInput', { images: [a] }), node('t', 'imageTransform', { options: { scale, detail: 'Smooth' } }), node('g', 'imageGeneration', { prompt: 'x' })];
    const edges = [edge('i', 't', 'image', 'image'), edge('t', 'g', 'image', 'references')];
    const board = await createBoard(make('2x'), edges);
    await runToEnd(board);
    const saved = await json<BoardPayload>(call('PUT', `/api/boards/${board.id}`, { name: 'T', baseRevision: board.revision, document: toDocument(make('3x'), edges) }));
    const second = await runToEnd(saved);
    const [t, g] = second.nodes;
    expect(t.outputs[0].width).toBe(120);
    expect(g.request?.referenceIds).toEqual([t.outputs[0].id]);
    const state = await json<BoardRunState>(call('GET', `/api/boards/${board.id}/state`));
    expect(state.outputs.t.map((o) => o.width)).toEqual([120]);
    // Running only the generation reuses the transform's latest result.
    const again = await runToEnd((await json<BoardPayload>(call('GET', `/api/boards/${board.id}`))), 'g');
    expect(again.nodes.find((n) => n.nodeId === 'g')!.request?.referenceIds).toEqual([t.outputs[0].id]);
  });

  it('reports a clear error and stops downstream nodes when an edit cannot be done', async () => {
    const a = await upload(await solid(40, 30, '#fff'), 'blank.png');
    const nodes = [node('i', 'imageInput', { images: [a] }), node('t', 'imageTransform', { operation: 'removeBackground', options: { tolerance: 20, softness: 1 } }), node('g', 'imageGeneration', { prompt: 'x' })];
    const board = await createBoard(nodes, [edge('i', 't', 'image', 'image'), edge('t', 'g', 'image', 'references')]);
    const result = await runToEnd(board);
    expect(result.status).toBe('failed');
    expect(result.nodes[0].status).toBe('failed');
    expect(result.nodes[0].error).toMatch(/blank\.png|No plain background|almost the whole/);
    expect(result.nodes[1].errorCategory).toBe('upstream');
  });

  it('fails clearly with nothing connected', async () => {
    const board = await createBoard([node('t', 'imageTransform')], []);
    const result = await runToEnd(board);
    expect(result.nodes[0].error).toMatch(/Needs an image/);
  });
});
