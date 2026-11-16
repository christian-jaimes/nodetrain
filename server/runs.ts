import { nanoid } from 'nanoid';
import type { BoardRunState, NodeExecStatus, NodeExecutionView, RunStatusApi, RunView } from '../shared/api';
import { fromDocument, migrateDocument } from '../shared/graph/document';
import type { AppNode, ImageAsset, ImageGenerationNode } from '../shared/graph/types';
import { planRun, resolveInputs, runKey, validateNode, type OutputLookup } from '../shared/graph/validate';
import type { ArtifactStore } from './artifacts';
import { tx, type DB } from './db';
import { ProviderError, type ImageProvider } from './providers/types';

type ExecRow = {
  id: string;
  run_id: string;
  board_id: string;
  node_id: string;
  node_title: string;
  seq: number;
  status: NodeExecStatus;
  error: string | null;
  error_category: string | null;
  request: string | null;
  output_ids: string;
  run_key: string | null;
  usage: string | null;
  started_at: number | null;
  ended_at: number | null;
};

type RunRow = {
  id: string;
  board_id: string;
  revision: number;
  target_node_id: string | null;
  status: RunStatusApi;
  created_at: number;
  ended_at: number | null;
};

export class RunError extends Error {
  status: 400 | 404 | 409;
  constructor(message: string, status: 400 | 404 | 409 = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * Runs workflow graphs on the server. A run snapshots one saved board
 * revision, so later edits never change what a past run did. Run and node
 * state is written to SQLite before work starts, so a refresh or restart
 * never loses it.
 */
export class Orchestrator {
  private queue: string[] = [];
  private busy = false;
  private controllers = new Map<string, AbortController>();
  private idleWaiters: (() => void)[] = [];

  constructor(
    private db: DB,
    private artifacts: ArtifactStore,
    private provider: ImageProvider,
  ) {}

  /** Runs that were in flight when the server stopped cannot resume a remote call, so mark them. */
  recoverInterrupted() {
    const now = Date.now();
    const msg = 'Interrupted: the NodeTrain server stopped during this run. Run it again.';
    tx(this.db, () => {
      this.db.prepare(`UPDATE node_executions SET status = 'failed', error = ?, error_category = 'internal', ended_at = ? WHERE status IN ('queued','running')`).run(msg, now);
      this.db.prepare(`UPDATE runs SET status = 'failed', ended_at = ? WHERE status IN ('queued','running')`).run(now);
    });
  }

  // ---------- Reading ----------

  private execView(r: ExecRow): NodeExecutionView {
    return {
      id: r.id,
      runId: r.run_id,
      nodeId: r.node_id,
      nodeTitle: r.node_title,
      status: r.status,
      error: r.error ?? undefined,
      errorCategory: r.error_category ?? undefined,
      request: r.request ? JSON.parse(r.request) : undefined,
      outputs: this.artifacts.getMany(JSON.parse(r.output_ids) as string[]),
      runKey: r.run_key ?? undefined,
      usage: r.usage ? JSON.parse(r.usage) : undefined,
      startedAt: r.started_at ?? undefined,
      endedAt: r.ended_at ?? undefined,
    };
  }

  getRun(id: string): RunView {
    const r = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as RunRow | undefined;
    if (!r) throw new RunError('Run not found.', 404);
    const rows = this.db.prepare('SELECT * FROM node_executions WHERE run_id = ? ORDER BY seq').all(id) as ExecRow[];
    return {
      id: r.id,
      boardId: r.board_id,
      revision: r.revision,
      targetNodeId: r.target_node_id,
      status: r.status,
      createdAt: r.created_at,
      endedAt: r.ended_at ?? undefined,
      nodes: rows.map((x) => this.execView(x)),
    };
  }

  boardState(boardId: string): BoardRunState {
    const rows = this.db
      .prepare('SELECT * FROM node_executions WHERE board_id = ? ORDER BY COALESCE(ended_at, started_at, 0) DESC, seq DESC')
      .all(boardId) as ExecRow[];
    const outputs: Record<string, ImageAsset[]> = {};
    const latest: Record<string, NodeExecutionView> = {};
    const lastSucceeded: BoardRunState['lastSucceeded'] = {};
    const activity: NodeExecutionView[] = [];
    for (const row of rows) {
      const view = this.execView(row);
      if (!latest[row.node_id]) latest[row.node_id] = view;
      if (row.status === 'succeeded') {
        (outputs[row.node_id] ??= []).push(...view.outputs);
        lastSucceeded[row.node_id] ??= { runKey: view.runKey, endedAt: view.endedAt };
      }
      if (activity.length < 100 && row.status !== 'queued' && row.status !== 'running') activity.push(view);
    }
    const active = this.db.prepare(`SELECT id FROM runs WHERE board_id = ? AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 1`).get(boardId) as
      | { id: string }
      | undefined;
    return { outputs, latest, lastSucceeded, activeRunId: active?.id ?? null, activity };
  }

  /** Latest successful output of a node across all runs, used when its board holds no selection. */
  private latestOutput(boardId: string, nodeId: string): ImageAsset | undefined {
    const row = this.db
      .prepare(`SELECT output_ids FROM node_executions WHERE board_id = ? AND node_id = ? AND status = 'succeeded' ORDER BY ended_at DESC LIMIT 1`)
      .get(boardId, nodeId) as { output_ids: string } | undefined;
    const ids = row ? (JSON.parse(row.output_ids) as string[]) : [];
    return ids.length ? this.artifacts.get(ids[0]) : undefined;
  }

  // ---------- Starting ----------

  start(boardId: string, revision: number, targetNodeId?: string | null): RunView {
    const board = this.db.prepare('SELECT revision FROM boards WHERE id = ?').get(boardId) as { revision: number } | undefined;
    if (!board) throw new RunError('Board not found.', 404);
    if (board.revision !== revision) throw new RunError('The board changed since it was last saved. Save and try again.', 409);
    const active = this.db.prepare(`SELECT id FROM runs WHERE board_id = ? AND status IN ('queued','running')`).get(boardId);
    if (active) throw new RunError('A run is already in progress for this board.', 409);

    const { nodes, edges } = this.loadRevision(boardId, revision);
    if (targetNodeId && !nodes.some((n) => n.id === targetNodeId)) throw new RunError('That node is not on the saved board.', 400);
    const order = planRun(nodes, edges, targetNodeId ?? undefined);
    if (!order.length) throw new RunError('Add an Image Generation node to run this workflow.', 400);

    const runId = nanoid(10);
    const now = Date.now();
    tx(this.db, () => {
      this.db.prepare('INSERT INTO runs (id, board_id, revision, target_node_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(runId, boardId, revision, targetNodeId ?? null, 'queued', now);
      const ins = this.db.prepare(`INSERT INTO node_executions (id, run_id, board_id, node_id, node_title, seq, status) VALUES (?, ?, ?, ?, ?, ?, 'queued')`);
      order.forEach((nodeId, i) => {
        const n = nodes.find((x) => x.id === nodeId)!;
        ins.run(nanoid(10), runId, boardId, nodeId, n.data.title, i);
      });
    });
    this.queue.push(runId);
    void this.pump();
    return this.getRun(runId);
  }

  cancel(runId: string): RunView {
    const run = this.getRun(runId);
    if (run.status === 'queued' || run.status === 'running') {
      this.db.prepare(`UPDATE runs SET status = 'canceled' WHERE id = ? AND status IN ('queued','running')`).run(runId);
      this.controllers.get(runId)?.abort();
    }
    return this.getRun(runId);
  }

  /** Resolves when no run is queued or executing. Used by tests and shutdown. */
  idle(): Promise<void> {
    if (!this.busy && !this.queue.length) return Promise.resolve();
    return new Promise((r) => this.idleWaiters.push(r));
  }

  private loadRevision(boardId: string, revision: number) {
    const row = this.db.prepare('SELECT document FROM board_revisions WHERE board_id = ? AND revision = ?').get(boardId, revision) as { document: string } | undefined;
    if (!row) throw new RunError('Saved board revision not found.', 404);
    return fromDocument(migrateDocument(JSON.parse(row.document)));
  }

  // ---------- Executing ----------

  private async pump() {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.queue.length) {
        const runId = this.queue.shift()!;
        try {
          await this.execute(runId);
        } catch (err) {
          console.error(`[run ${runId}] crashed`, err);
          this.finishRun(runId);
        }
      }
    } finally {
      this.busy = false;
      this.idleWaiters.splice(0).forEach((r) => r());
    }
  }

  private setExec(id: string, patch: Partial<Pick<ExecRow, 'status' | 'error' | 'error_category' | 'request' | 'output_ids' | 'run_key' | 'usage' | 'started_at' | 'ended_at'>>) {
    const keys = Object.keys(patch) as (keyof typeof patch)[];
    this.db.prepare(`UPDATE node_executions SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => patch[k] ?? null), id);
  }

  private isCanceled(runId: string) {
    return (this.db.prepare('SELECT status FROM runs WHERE id = ?').get(runId) as { status: string }).status === 'canceled';
  }

  private async execute(runId: string) {
    const run = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as RunRow;
    if (run.status !== 'queued') return;
    this.db.prepare(`UPDATE runs SET status = 'running' WHERE id = ?`).run(runId);
    const { nodes, edges } = this.loadRevision(run.board_id, run.revision);
    const execs = this.db.prepare('SELECT * FROM node_executions WHERE run_id = ? ORDER BY seq').all(runId) as ExecRow[];

    // Outputs produced earlier in this run take precedence for downstream nodes.
    const produced = new Map<string, ImageAsset>();
    const failed = new Set<string>();
    const outputOf: OutputLookup = (n) => {
      if (produced.has(n.id)) return produced.get(n.id);
      const sel = n.data.selectedOutputId ? this.artifacts.get(n.data.selectedOutputId) : undefined;
      return sel ?? this.latestOutput(run.board_id, n.id);
    };
    const controller = new AbortController();
    this.controllers.set(runId, controller);

    try {
      for (const ex of execs) {
        const now = Date.now();
        if (this.isCanceled(runId)) {
          this.setExec(ex.id, { status: 'canceled', error: 'Canceled before it started.', error_category: 'canceled', ended_at: now });
          continue;
        }
        const node = nodes.find((n) => n.id === ex.node_id) as AppNode | undefined;
        if (!node || node.type !== 'imageGeneration') {
          this.setExec(ex.id, { status: 'failed', error: 'Node is missing from the saved board.', error_category: 'internal', ended_at: now });
          failed.add(ex.node_id);
          continue;
        }
        if (edges.some((e) => e.target === node.id && failed.has(e.source))) {
          this.setExec(ex.id, { status: 'failed', error: 'An upstream step failed. Fix it and run again.', error_category: 'upstream', ended_at: now });
          failed.add(node.id);
          continue;
        }
        const issues = validateNode(node, nodes, edges, outputOf);
        if (issues.length) {
          this.setExec(ex.id, { status: 'failed', error: issues[0].detail, error_category: 'invalid_input', ended_at: now });
          failed.add(node.id);
          continue;
        }
        await this.runGeneration(runId, ex, node, nodes, edges, outputOf, produced, failed, controller.signal);
      }
    } finally {
      this.controllers.delete(runId);
      this.finishRun(runId);
    }
  }

  private async runGeneration(
    runId: string,
    ex: ExecRow,
    node: ImageGenerationNode,
    nodes: AppNode[],
    edges: { source: string; target: string; targetHandle?: string | null }[],
    outputOf: OutputLookup,
    produced: Map<string, ImageAsset>,
    failed: Set<string>,
    signal: AbortSignal,
  ) {
    const inputs = resolveInputs(node, nodes, edges as never, outputOf);
    const d = node.data;
    const request = {
      prompt: inputs.prompt,
      referenceIds: inputs.references.map((r) => r.id),
      model: d.model,
      aspectRatio: d.aspectRatio,
      quality: d.quality,
      provider: this.provider.id,
    };
    this.setExec(ex.id, { status: 'running', started_at: Date.now(), request: JSON.stringify(request) });
    try {
      const references = inputs.references.map((r) => {
        const f = this.artifacts.file(r.id);
        if (!f) throw new ProviderError(`Reference image ${r.name} is missing from storage.`, 'invalid_input');
        return { id: r.id, path: f.path, mime: f.mime, width: r.width, height: r.height };
      });
      const result = await this.provider.generateImage({ prompt: inputs.prompt, references, model: d.model, aspectRatio: d.aspectRatio, quality: d.quality, signal });
      const assets: ImageAsset[] = [];
      for (const [i, img] of result.images.entries()) {
        assets.push(
          await this.artifacts.save(img.data, {
            name: `${d.title.replace(/[^\w-]+/g, '-').toLowerCase()}-${runId}-${i + 1}.${img.mime.split('/')[1]}`,
            provider: this.provider.id,
            runId,
            provenance: { runId, nodeId: node.id, ...request, usage: result.usage },
          }),
        );
      }
      if (!assets.length) throw new ProviderError('The provider returned no images.', 'outage', true);
      produced.set(node.id, assets[0]);
      this.setExec(ex.id, {
        status: 'succeeded',
        output_ids: JSON.stringify(assets.map((a) => a.id)),
        run_key: runKey(node, nodes, edges as never, outputOf),
        usage: result.usage ? JSON.stringify(result.usage) : null,
        ended_at: Date.now(),
      });
    } catch (err) {
      failed.add(node.id);
      const pe = err instanceof ProviderError ? err : new ProviderError(err instanceof Error ? err.message : 'Generation failed.', 'internal');
      this.setExec(ex.id, {
        status: pe.category === 'canceled' ? 'canceled' : 'failed',
        error: pe.category === 'canceled' ? 'Canceled while generating.' : pe.message,
        error_category: pe.category,
        ended_at: Date.now(),
      });
    }
  }

  private finishRun(runId: string) {
    const statuses = (this.db.prepare('SELECT status FROM node_executions WHERE run_id = ?').all(runId) as { status: NodeExecStatus }[]).map((r) => r.status);
    const ok = statuses.filter((s) => s === 'succeeded').length;
    const current = (this.db.prepare('SELECT status FROM runs WHERE id = ?').get(runId) as { status: RunStatusApi }).status;
    let status: RunStatusApi;
    if (current === 'canceled') status = 'canceled';
    else if (ok === statuses.length) status = 'succeeded';
    else if (ok > 0) status = 'partial';
    else status = 'failed';
    this.db.prepare('UPDATE runs SET status = ?, ended_at = ? WHERE id = ?').run(status, Date.now(), runId);
  }
}
