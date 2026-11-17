import { createReadStream, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { Hono, type Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { nanoid } from 'nanoid';
import { KEY_PROVIDERS, type BoardPayload, type BoardSummary, type SaveBoardRequest } from '../shared/api';
import { DocumentError, migrateDocument, type BoardDocument } from '../shared/graph/document';
import { ArtifactError, ArtifactStore, MAX_UPLOAD_BYTES } from './artifacts';
import { openDatabase, tx, type DB } from './db';
import { ProviderManager } from './providers/manager';
import { SimulatedProvider } from './providers/simulated';
import { ProviderError, type ImageProvider } from './providers/types';
import { ProfileStore } from './profile';
import { Orchestrator, RunError } from './runs';

export type AppOptions = {
  dataDir: string;
  /** Fixed provider (tests). Ignored when `providers` is given. */
  provider?: ImageProvider;
  /** Switchable provider with key management (the real server). */
  providers?: (dataDir: string) => ProviderManager;
};

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function hostnameOf(value: string | undefined) {
  if (!value) return undefined;
  try {
    return new URL(value.includes('://') ? value : `http://${value}`).hostname;
  } catch {
    return '';
  }
}

type BoardRow = { id: string; name: string; revision: number; favorite: number; created_at: number; updated_at: number };

const EMPTY_DOC: BoardDocument = { format: 'nodetrain.board', version: 1, nodes: [], edges: [] };

function cleanName(name: unknown) {
  return typeof name === 'string' && name.trim() ? name.trim().slice(0, 120) : 'Untitled workflow';
}

export function createApp({ dataDir, provider = new SimulatedProvider(), providers: makeProviders }: AppOptions) {
  mkdirSync(dataDir, { recursive: true });
  const db: DB = openDatabase(join(dataDir, 'nodetrain.db'));
  const artifacts = new ArtifactStore(db, dataDir);
  const providers = makeProviders ? makeProviders(dataDir) : ProviderManager.fixed(dataDir, provider);
  const profile = new ProfileStore(dataDir);
  const runs = new Orchestrator(db, artifacts, () => providers.current());
  runs.recoverInterrupted();

  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof ArtifactError || err instanceof RunError) return c.json({ error: err.message }, err.status);
    if (err instanceof DocumentError) return c.json({ error: err.message, code: 'invalid_document' }, 400);
    if (err instanceof ProviderError) return c.json({ error: err.message, code: err.category }, err.category === 'transient' || err.category === 'outage' ? 502 : 400);
    if (err instanceof SyntaxError) return c.json({ error: 'Request body is not valid JSON.' }, 400);
    console.error(err);
    return c.json({ error: 'Something went wrong on the NodeTrain server.' }, 500);
  });

  app.use('/api/*', async (c, next) => {
    // Only this computer's own pages may talk to the server. Blocks DNS rebinding and other sites posting to localhost.
    const host = hostnameOf(c.req.header('host'));
    const origin = c.req.header('origin');
    if ((host && !LOCAL_HOSTS.has(host)) || (origin && !LOCAL_HOSTS.has(hostnameOf(origin) ?? ''))) return c.json({ error: 'Forbidden.' }, 403);
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Cache-Control', c.res.headers.get('Cache-Control') ?? 'no-store');
  });

  // Never includes credentials: only which provider is active and what it supports.
  app.get('/api/health', (c) => {
    const p = providers.current();
    return c.json({ ok: true, provider: { id: p.id, label: p.label, ...p.capabilities() } });
  });

  // ---------- Settings ----------

  app.get('/api/settings', (c) => c.json(providers.status()));
  // The custom header can't be sent cross-site without a CORS preflight, which this server never grants.
  const requireAppHeader = async (c: Context, next: () => Promise<void>) => {
    if (c.req.header('x-nodetrain-client') !== '1') return c.json({ error: 'Forbidden.' }, 403);
    await next();
  };
  // Keys are addressed by provider id. OpenAI is the only one registered so far (see KEY_PROVIDERS).
  const knownProvider = (c: Context) => KEY_PROVIDERS.some((p) => p.id === c.req.param('provider'));
  app.put('/api/settings/keys/:provider', requireAppHeader, async (c) => {
    if (!knownProvider(c)) return c.json({ error: 'Unknown provider.' }, 404);
    const body = (await c.req.json()) as { apiKey?: unknown };
    return c.json(await providers.setKey(body.apiKey));
  });
  app.delete('/api/settings/keys/:provider', requireAppHeader, (c) => (knownProvider(c) ? c.json(providers.clearKey()) : c.json({ error: 'Unknown provider.' }, 404)));

  app.get('/api/profile', (c) => c.json(profile.get()));
  app.put('/api/profile', requireAppHeader, async (c) => c.json(profile.set(await c.req.json())));

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
        `SELECT b.id, b.name, b.revision, b.favorite, b.created_at, b.updated_at, r.document FROM boards b
         JOIN board_revisions r ON r.board_id = b.id AND r.revision = b.revision ORDER BY b.updated_at DESC`,
      )
      .all() as (BoardRow & { document: string })[];
    const list: BoardSummary[] = rows.map((r) => {
      const doc = JSON.parse(r.document) as BoardDocument;
      return {
        id: r.id,
        name: r.name,
        revision: r.revision,
        favorite: Boolean(r.favorite),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        nodeCount: doc.nodes.length,
        preview: {
          nodes: doc.nodes.slice(0, 60).map((n) => ({ id: n.id, x: n.position.x, y: n.position.y, type: n.type })),
          edges: doc.edges.map((e) => ({ source: e.source, target: e.target })),
        },
      };
    });
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

  // Favoriting is not an edit: it changes neither the revision nor "last modified".
  app.patch('/api/boards/:id', async (c) => {
    const body = (await c.req.json()) as { favorite?: unknown };
    if (typeof body.favorite !== 'boolean') return c.json({ error: 'Nothing to change.' }, 400);
    const info = db.prepare('UPDATE boards SET favorite = ? WHERE id = ?').run(body.favorite ? 1 : 0, c.req.param('id'));
    return info.changes ? c.json(boardPayload(c.req.param('id'))) : c.json({ error: 'Board not found.' }, 404);
  });

  // Copies the graph and the finished run history. Images are never copied: the duplicate points at the same image files.
  app.post('/api/boards/:id/duplicate', (c) => {
    const src = boardPayload(c.req.param('id'));
    if (!src) return c.json({ error: 'Board not found.' }, 404);
    const id = nanoid(10);
    const now = Date.now();
    const name = `${src.name} copy`.slice(0, 120);
    tx(db, () => {
      db.prepare('INSERT INTO boards (id, name, revision, created_at, updated_at) VALUES (?, ?, 1, ?, ?)').run(id, name, now, now);
      db.prepare('INSERT INTO board_revisions (board_id, revision, name, document, created_at) VALUES (?, 1, ?, ?, ?)').run(id, name, JSON.stringify(src.document), now);
      const runRows = db.prepare(`SELECT * FROM runs WHERE board_id = ? AND status NOT IN ('queued','running')`).all(src.id) as {
        id: string; target_node_id: string | null; status: string; created_at: number; ended_at: number | null;
      }[];
      for (const r of runRows) {
        const runId = nanoid(10);
        db.prepare('INSERT INTO runs (id, board_id, revision, target_node_id, status, created_at, ended_at) VALUES (?, ?, 1, ?, ?, ?, ?)').run(runId, id, r.target_node_id, r.status, r.created_at, r.ended_at);
        const execs = db.prepare('SELECT * FROM node_executions WHERE run_id = ?').all(r.id) as Record<string, string | number | null>[];
        for (const e of execs) {
          db.prepare(
            `INSERT INTO node_executions (id, run_id, board_id, node_id, node_title, seq, status, error, error_category, request, output_ids, run_key, usage, started_at, ended_at, copied)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          ).run(nanoid(10), runId, id, e.node_id, e.node_title, e.seq, e.status, e.error, e.error_category, e.request, e.output_ids, e.run_key, e.usage, e.started_at, e.ended_at);
        }
      }
    });
    return c.json(boardPayload(id), 201);
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
    const body = (await c.req.json()) as { revision: number; targetNodeId?: string | null; upstream?: boolean };
    return c.json(runs.start(c.req.param('id'), body.revision, body.targetNodeId, body.upstream !== false), 202);
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

  return { app, db, runs, artifacts, providers, close: () => db.close() };
}
