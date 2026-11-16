import { createReadStream, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { nanoid } from 'nanoid';
import type { BoardPayload, BoardSummary, SaveBoardRequest } from '../shared/api';
import { DocumentError, migrateDocument, type BoardDocument } from '../shared/graph/document';
import { ArtifactError, ArtifactStore, MAX_UPLOAD_BYTES } from './artifacts';
import { openDatabase, tx, type DB } from './db';
import { SimulatedProvider } from './providers/simulated';
import type { ImageProvider } from './providers/types';
import { Orchestrator, RunError } from './runs';

export type AppOptions = { dataDir: string; provider?: ImageProvider };

type BoardRow = { id: string; name: string; revision: number; created_at: number; updated_at: number };

const EMPTY_DOC: BoardDocument = { format: 'nodetrain.board', version: 1, nodes: [], edges: [] };

function cleanName(name: unknown) {
  return typeof name === 'string' && name.trim() ? name.trim().slice(0, 120) : 'Untitled workflow';
}

export function createApp({ dataDir, provider = new SimulatedProvider() }: AppOptions) {
  mkdirSync(dataDir, { recursive: true });
  const db: DB = openDatabase(join(dataDir, 'nodetrain.db'));
  const artifacts = new ArtifactStore(db, dataDir);
  const runs = new Orchestrator(db, artifacts, provider);
  runs.recoverInterrupted();

  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof ArtifactError || err instanceof RunError) return c.json({ error: err.message }, err.status);
    if (err instanceof DocumentError) return c.json({ error: err.message, code: 'invalid_document' }, 400);
    if (err instanceof SyntaxError) return c.json({ error: 'Request body is not valid JSON.' }, 400);
    console.error(err);
    return c.json({ error: 'Something went wrong on the NodeTrain server.' }, 500);
  });

  app.use('/api/*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Cache-Control', c.res.headers.get('Cache-Control') ?? 'no-store');
  });

  // Never includes credentials: only which provider is active and what it supports.
  app.get('/api/health', (c) => c.json({ ok: true, provider: { id: provider.id, label: provider.label, ...provider.capabilities() } }));

  // ---------- Boards ----------

  const boardPayload = (id: string): BoardPayload | undefined => {
    const b = db.prepare('SELECT * FROM boards WHERE id = ?').get(id) as BoardRow | undefined;
    if (!b) return undefined;
    const r = db.prepare('SELECT document FROM board_revisions WHERE board_id = ? AND revision = ?').get(id, b.revision) as { document: string };
    return { id: b.id, name: b.name, revision: b.revision, document: migrateDocument(JSON.parse(r.document)), updatedAt: b.updated_at };
  };

  app.get('/api/boards', (c) => {
    const rows = db
      .prepare(
        `SELECT b.id, b.name, b.revision, b.updated_at, r.document FROM boards b
         JOIN board_revisions r ON r.board_id = b.id AND r.revision = b.revision ORDER BY b.updated_at DESC`,
      )
      .all() as (BoardRow & { document: string })[];
    const list: BoardSummary[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      revision: r.revision,
      updatedAt: r.updated_at,
      nodeCount: (JSON.parse(r.document) as BoardDocument).nodes.length,
    }));
    return c.json(list);
  });

  app.post('/api/boards', async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { name?: string; document?: unknown };
    const doc = body.document ? migrateDocument(body.document) : EMPTY_DOC;
    const id = nanoid(10);
    const now = Date.now();
    const name = cleanName(body.name);
    tx(db, () => {
      db.prepare('INSERT INTO boards (id, name, revision, created_at, updated_at) VALUES (?, ?, 1, ?, ?)').run(id, name, now, now);
      db.prepare('INSERT INTO board_revisions (board_id, revision, name, document, created_at) VALUES (?, 1, ?, ?, ?)').run(id, name, JSON.stringify(doc), now);
    });
    return c.json(boardPayload(id), 201);
  });

  app.get('/api/boards/:id', (c) => {
    const b = boardPayload(c.req.param('id'));
    return b ? c.json(b) : c.json({ error: 'Board not found.' }, 404);
  });

  app.put('/api/boards/:id', async (c) => {
    const id = c.req.param('id');
    const body = (await c.req.json()) as SaveBoardRequest;
    const doc = migrateDocument(body.document);
    const name = cleanName(body.name);
    const result = tx(db, () => {
      const b = db.prepare('SELECT * FROM boards WHERE id = ?').get(id) as BoardRow | undefined;
      if (!b) return { status: 404 as const };
      if (b.revision !== body.baseRevision) return { status: 409 as const, revision: b.revision };
      const cur = db.prepare('SELECT document FROM board_revisions WHERE board_id = ? AND revision = ?').get(id, b.revision) as { document: string };
      const json = JSON.stringify(doc);
      // Nothing changed: keep the revision so idle autosaves don't pile up history.
      if (cur.document === json && b.name === name) return { status: 200 as const };
      const now = Date.now();
      const next = b.revision + 1;
      db.prepare('INSERT INTO board_revisions (board_id, revision, name, document, created_at) VALUES (?, ?, ?, ?, ?)').run(id, next, name, json, now);
      db.prepare('UPDATE boards SET name = ?, revision = ?, updated_at = ? WHERE id = ?').run(name, next, now, id);
      return { status: 200 as const };
    });
    if (result.status === 404) return c.json({ error: 'Board not found.' }, 404);
    if (result.status === 409) return c.json({ error: 'This board was changed somewhere else (another tab?). Reload to get the latest version.', code: 'conflict', revision: result.revision }, 409);
    return c.json(boardPayload(id));
  });

  app.delete('/api/boards/:id', (c) => {
    const id = c.req.param('id');
    // Revisions go with the board. Run history and image files are kept.
    const info = db.prepare('DELETE FROM boards WHERE id = ?').run(id);
    return info.changes ? c.body(null, 204) : c.json({ error: 'Board not found.' }, 404);
  });

  app.get('/api/boards/:id/state', (c) => c.json(runs.boardState(c.req.param('id'))));

  // ---------- Runs ----------

  app.post('/api/boards/:id/runs', async (c) => {
    const body = (await c.req.json()) as { revision: number; targetNodeId?: string | null };
    return c.json(runs.start(c.req.param('id'), body.revision, body.targetNodeId), 202);
  });
  app.get('/api/runs/:id', (c) => c.json(runs.getRun(c.req.param('id'))));
  app.post('/api/runs/:id/cancel', (c) => c.json(runs.cancel(c.req.param('id'))));

  // ---------- Artifacts ----------

  app.post('/api/artifacts', bodyLimit({ maxSize: MAX_UPLOAD_BYTES, onError: (c) => c.json({ error: 'Images must be 25 MB or smaller.' }, 413) }), async (c) => {
    const data = Buffer.from(await c.req.arrayBuffer());
    const name = decodeURIComponent(c.req.header('x-file-name') ?? '') || undefined;
    return c.json(await artifacts.save(data, { name }), 201);
  });

  const sendArtifact = (c: Context, variant: 'full' | 'thumb') => {
    const f = artifacts.file(c.req.param('id') ?? '', variant);
    if (!f || !existsSync(f.path)) return c.json({ error: 'Image not found.' }, 404);
    // Artifacts never change, so the browser may cache them forever.
    return new Response(Readable.toWeb(createReadStream(f.path)) as ReadableStream, {
      headers: { 'Content-Type': f.mime, 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' },
    });
  };
  app.get('/api/artifacts/:id', (c) => sendArtifact(c, 'full'));
  app.get('/api/artifacts/:id/thumb', (c) => sendArtifact(c, 'thumb'));

  app.all('/api/*', (c) => c.json({ error: 'Not found.' }, 404));

  return { app, db, runs, artifacts, close: () => db.close() };
}
