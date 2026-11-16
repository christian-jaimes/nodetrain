import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BoardPayload, BoardRunState, BoardSummary, Profile, RunView } from '../shared/api';
import { CATALOG } from '../shared/graph/catalog';
import { toDocument } from '../shared/graph/document';
import type { AppEdge, AppNode, ImageAsset, NodeKind } from '../shared/graph/types';
import { createApp } from '../server/app';
import { SimulatedProvider } from '../server/providers/simulated';
import type { ImageProvider } from '../server/providers/types';

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

const H = { 'x-nodetrain-client': '1' };
const callH = (method: string, path: string, body?: unknown) =>
  ctx.app.request(path, { method, headers: { 'content-type': 'application/json', ...H }, body: body === undefined ? undefined : JSON.stringify(body) });

describe('workflow gallery', () => {
  it('lists favorites, creation time and a layout preview; favoriting keeps the revision and modified time', async () => {
    make();
    const b = await createBoard([node('p', 'prompt'), node('g', 'imageGeneration')], [edge('p', 'g', 'text', 'prompt')]);
    const [before] = await json<BoardSummary[]>(call('GET', '/api/boards'));
    expect(before.favorite).toBe(false);
    expect(before.preview.nodes.map((n) => n.id)).toEqual(['p', 'g']);
    expect(before.preview.edges).toEqual([{ source: 'p', target: 'g' }]);

    const res = await call('PATCH', `/api/boards/${b.id}`, { favorite: true });
    expect(res.status).toBe(200);
    const [after] = await json<BoardSummary[]>(call('GET', '/api/boards'));
    expect(after.favorite).toBe(true);
    expect(after.revision).toBe(before.revision);
    expect(after.updatedAt).toBe(before.updatedAt);
    expect((await call('PATCH', '/api/boards/nope', { favorite: true })).status).toBe(404);
    expect((await call('PATCH', `/api/boards/${b.id}`, { favorite: 'yes' })).status).toBe(400);
  });

  it('duplicates the graph and run history, pointing at the same images without copying files or spend', async () => {
    make();
    const ref = (await (await upload(await png())).json()) as ImageAsset;
    const b = await createBoard([node('i', 'imageInput', { images: [ref] }), node('g', 'imageGeneration', { prompt: 'A bottle' })], [edge('i', 'g', 'image', 'references')]);
    await runToEnd(b.id, b.revision);
    const original = await json<BoardRunState>(call('GET', `/api/boards/${b.id}/state`));

    const res = await call('POST', `/api/boards/${b.id}/duplicate`);
    expect(res.status).toBe(201);
    const copy = (await res.json()) as BoardPayload;
    expect(copy.id).not.toBe(b.id);
    expect(copy.name).toBe('Test copy');
    expect(copy.document.nodes).toEqual(b.document.nodes);

    const state = await json<BoardRunState>(call('GET', `/api/boards/${copy.id}/state`));
    expect(state.outputs.g.map((o) => o.id)).toEqual(original.outputs.g.map((o) => o.id));
    expect(state.lastSucceeded.g.runKey).toBe(original.lastSucceeded.g.runKey);
    expect(state.spend.board).toBe(0);
    expect(state.spend.today).toBe(original.spend.today);
    expect(ctx.db.prepare('SELECT COUNT(*) AS n FROM artifacts').get()).toEqual({ n: 2 });

    // Removing the original leaves the copy and the shared images intact.
    expect((await call('DELETE', `/api/boards/${b.id}`)).status).toBe(204);
    const still = await json<BoardRunState>(call('GET', `/api/boards/${copy.id}/state`));
    expect(still.outputs.g).toHaveLength(1);
    expect((await call('POST', '/api/boards/nope/duplicate')).status).toBe(404);
  });
});

describe('profile', () => {
  it('stores a name and picture, and rejects other content or a missing app header', async () => {
    make();
    expect(await json<Profile>(call('GET', '/api/profile'))).toEqual({ name: '', picture: null });
    const pic = `data:image/png;base64,${(await png(8, 8)).toString('base64')}`;
    const saved = await json<Profile>(callH('PUT', '/api/profile', { name: '  CJ  ', picture: pic }));
    expect(saved).toEqual({ name: 'CJ', picture: pic });
    expect(await json<Profile>(call('GET', '/api/profile'))).toEqual(saved);
    expect((await callH('PUT', '/api/profile', { name: 'x', picture: 'data:text/html;base64,AAAA' })).status).toBe(400);
    expect((await call('PUT', '/api/profile', { name: 'x' }, )).status).toBe(403);
    expect((await callH('PUT', '/api/settings/keys/other', {})).status).toBe(404);
  });
});
