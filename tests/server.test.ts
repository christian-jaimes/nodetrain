import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BoardPayload, BoardRunState, RunView } from '../shared/api';
import { CATALOG } from '../shared/graph/catalog';
import { toDocument } from '../shared/graph/document';
import type { AppEdge, AppNode, ImageAsset, NodeKind } from '../shared/graph/types';
import { createApp } from '../server/app';
import { SimulatedProvider } from '../server/providers/simulated';
import { ProviderError, type ImageProvider } from '../server/providers/types';

let dir: string;
let ctx: ReturnType<typeof createApp>;

const make = (provider: ImageProvider = new SimulatedProvider([5, 10])) => {
  ctx = createApp({ dataDir: dir, provider });
  return ctx;
};

const json = async <T>(res: Response | Promise<Response>) => (await res).json() as Promise<T>;
const call = (method: string, path: string, body?: unknown) =>
  ctx.app.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

const node = (id: string, kind: NodeKind, patch: Record<string, unknown> = {}): AppNode =>
  ({ id, type: kind, position: { x: 0, y: 0 }, data: { ...CATALOG[kind].create(), ...patch } }) as AppNode;
const edge = (source: string, target: string, sourceHandle: string, targetHandle: string): AppEdge => ({ id: `${source}-${target}`, source, target, sourceHandle, targetHandle });

async function png(w = 64, h = 48, color = '#c96') {
  return sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();
}

async function upload(data: Buffer, name = 'ref.png') {
  return ctx.app.request('/api/artifacts', { method: 'POST', headers: { 'x-file-name': name }, body: new Uint8Array(data) });
}

async function createBoard(nodes: AppNode[], edges: AppEdge[]) {
  return json<BoardPayload>(call('POST', '/api/boards', { name: 'Test', document: toDocument(nodes, edges) }));
}

async function runToEnd(boardId: string, revision: number, targetNodeId?: string) {
  const res = await call('POST', `/api/boards/${boardId}/runs`, { revision, targetNodeId });
  expect(res.status).toBe(202);
  const run = (await res.json()) as RunView;
  await ctx.runs.idle();
  return json<RunView>(call('GET', `/api/runs/${run.id}`));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nodetrain-test-'));
});
afterEach(() => {
  ctx?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('boards', () => {
  it('creates, lists, saves new revisions and rejects stale saves', async () => {
    make();
    const b = await createBoard([node('p', 'prompt', { text: 'hi' })], []);
    expect(b.revision).toBe(1);
    expect((await json<unknown[]>(call('GET', '/api/boards'))).length).toBe(1);

    const doc2 = toDocument([node('p', 'prompt', { text: 'changed' })], []);
    const saved = await json<BoardPayload>(call('PUT', `/api/boards/${b.id}`, { name: 'Renamed', baseRevision: 1, document: doc2 }));
    expect(saved.revision).toBe(2);
    expect(saved.name).toBe('Renamed');

    // Same content again: no new revision.
    const same = await json<BoardPayload>(call('PUT', `/api/boards/${b.id}`, { name: 'Renamed', baseRevision: 2, document: doc2 }));
    expect(same.revision).toBe(2);

    const stale = await call('PUT', `/api/boards/${b.id}`, { name: 'x', baseRevision: 1, document: doc2 });
    expect(stale.status).toBe(409);
  });

  it('rejects invalid documents', async () => {
    make();
    const res = await call('POST', '/api/boards', { name: 'Bad', document: { version: 1, nodes: [{ id: 1 }], edges: [] } });
    expect(res.status).toBe(400);
  });
});

describe('artifacts', () => {
  it('stores a real image once and serves it', async () => {
    make();
    const data = await png(900, 600);
    const a = (await (await upload(data, 'photo.png')).json()) as ImageAsset;
    expect(a).toMatchObject({ width: 900, height: 600, mime: 'image/png', name: 'photo.png' });
    expect(a.thumb).toBeTruthy();
    const again = (await (await upload(data)).json()) as ImageAsset;
    expect(again.id).toBe(a.id);
    const file = await ctx.app.request(a.src);
    expect(file.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await file.arrayBuffer()).equals(data)).toBe(true);
  });

  it('rejects files that are not images, whatever their name', async () => {
    make();
    const res = await upload(Buffer.from('<script>alert(1)</script>'), 'evil.png');
    expect(res.status).toBe(400);
  });
});

describe('runs', () => {
  it('runs a workflow, stores outputs as artifacts and reports them per node', async () => {
    make();
    const ref = (await (await upload(await png())).json()) as ImageAsset;
    const nodes = [node('p', 'prompt', { text: 'A bottle' }), node('i', 'imageInput', { images: [ref] }), node('g1', 'imageGeneration'), node('g2', 'imageGeneration', { prompt: 'Closer' })];
    const edges = [edge('p', 'g1', 'text', 'prompt'), edge('i', 'g1', 'image', 'references'), edge('g1', 'g2', 'image', 'references')];
    const b = await createBoard(nodes, edges);
    const run = await runToEnd(b.id, b.revision);

    expect(run.status).toBe('succeeded');
    expect(run.nodes.map((n) => n.nodeId)).toEqual(['g1', 'g2']);
    const [r1, r2] = run.nodes;
    expect(r1.request?.prompt).toBe('A bottle');
    expect(r1.request?.referenceIds).toEqual([ref.id]);
    expect(r1.outputs[0].provider).toBe('simulated');
    // g2 used the image g1 produced in the same run.
    expect(r2.request?.referenceIds).toEqual([r1.outputs[0].id]);
    expect(r2.runKey).toBeTruthy();

    const state = await json<BoardRunState>(call('GET', `/api/boards/${b.id}/state`));
    expect(state.outputs.g1).toHaveLength(1);
    expect(state.latest.g2.status).toBe('succeeded');
    expect(state.activeRunId).toBeNull();
  });

  it('fails a node with no prompt, skips what depends on it, and still runs the rest', async () => {
    make();
    const nodes = [node('bad', 'imageGeneration'), node('after', 'imageGeneration', { prompt: 'x' }), node('ok', 'imageGeneration', { prompt: 'y' })];
    const b = await createBoard(nodes, [edge('bad', 'after', 'image', 'references')]);
    const run = await runToEnd(b.id, b.revision);
    const by = Object.fromEntries(run.nodes.map((n) => [n.nodeId, n]));
    expect(run.status).toBe('partial');
    expect(by.bad).toMatchObject({ status: 'failed', errorCategory: 'invalid_input' });
    expect(by.after).toMatchObject({ status: 'failed', errorCategory: 'upstream' });
    expect(by.ok.status).toBe('succeeded');
  });

  it('only runs from a saved revision', async () => {
    make();
    const b = await createBoard([node('g', 'imageGeneration', { prompt: 'x' })], []);
    const res = await call('POST', `/api/boards/${b.id}/runs`, { revision: b.revision + 1 });
    expect(res.status).toBe(409);
  });

  it('records provider errors with their category', async () => {
    const failing: ImageProvider = {
      id: 'broken',
      label: 'Broken',
      capabilities: () => ({ models: [], maxReferences: 0, aspectRatios: [], qualities: [] }),
      generateImage: async () => {
        throw new ProviderError('Rate limited.', 'quota', true);
      },
    };
    make(failing);
    const b = await createBoard([node('g', 'imageGeneration', { prompt: 'x' })], []);
    const run = await runToEnd(b.id, b.revision);
    expect(run.status).toBe('failed');
    expect(run.nodes[0]).toMatchObject({ status: 'failed', error: 'Rate limited.', errorCategory: 'quota' });
  });

  it('estimates cost from reported usage and totals spend', async () => {
    const image = await png();
    const priced: ImageProvider = {
      id: 'priced',
      label: 'Priced',
      capabilities: () => ({ models: [], maxReferences: 0, aspectRatios: [], qualities: [] }),
      // 100 text tokens at $5/M + 10,000 output tokens at $30/M = $0.3005
      generateImage: async () => ({ images: [{ data: image, mime: 'image/png' }], usage: { inputTokens: 100, inputTextTokens: 100, inputImageTokens: 0, outputTokens: 10_000, totalTokens: 10_100 } }),
    };
    make(priced);
    const b = await createBoard([node('g', 'imageGeneration', { prompt: 'x', model: 'gpt-image-2.6-flare' })], []);
    const run = await runToEnd(b.id, b.revision);
    expect(run.nodes[0].costUsd).toBeCloseTo(0.3005, 6);
    await runToEnd(b.id, b.revision);
    const state = await json<BoardRunState>(call('GET', `/api/boards/${b.id}/state`));
    expect(state.spend.board).toBeCloseTo(0.601, 6);
    expect(state.spend.today).toBeCloseTo(0.601, 6);
    expect(state.activity[0].costUsd).toBeCloseTo(0.3005, 6);
  });

  it('can be canceled', async () => {
    make(new SimulatedProvider([300, 300]));
    const b = await createBoard([node('a', 'imageGeneration', { prompt: 'x' }), node('b', 'imageGeneration', { prompt: 'y' })], []);
    const started = await json<RunView>(call('POST', `/api/boards/${b.id}/runs`, { revision: b.revision }));
    await new Promise((r) => setTimeout(r, 50));
    await call('POST', `/api/runs/${started.id}/cancel`);
    await ctx.runs.idle();
    const run = await json<RunView>(call('GET', `/api/runs/${started.id}`));
    expect(run.status).toBe('canceled');
    expect(run.nodes.every((n) => n.status === 'canceled')).toBe(true);
  });

  it('marks runs interrupted by a restart as failed', async () => {
    make(new SimulatedProvider([5000, 5000]));
    const b = await createBoard([node('g', 'imageGeneration', { prompt: 'x' })], []);
    const started = await json<RunView>(call('POST', `/api/boards/${b.id}/runs`, { revision: b.revision }));
    await new Promise((r) => setTimeout(r, 30));
    ctx.close();
    make();
    const run = await json<RunView>(call('GET', `/api/runs/${started.id}`));
    expect(run.status).toBe('failed');
    expect(run.nodes[0].error).toMatch(/Interrupted/);
  });
});
