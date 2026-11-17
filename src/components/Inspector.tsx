import { useReactFlow } from '@xyflow/react';
import { Download, History, Play, Redo2, Scan, Square, Trash2, Undo2, Upload, X } from 'lucide-react';
import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { CATALOG } from '../../shared/graph/catalog';
import { formatUsd } from '../../shared/graph/models';
import { FIT_OPTIONS } from '../lib/ui';
import type { AppNode, ImageGenerationNode as GenNode, ImageInputNode, PromptNode, RunStatus } from '../../shared/graph/types';
import { selectedOutput, validateGraph } from '../../shared/graph/validate';
import type { NodeExecutionView } from '../../shared/api';
import { exportWorkflow, useBoard } from '../store/board';
import { NodeIconTile } from './icons';
import { useImageImport } from './nodes/ImageInputNode';
import { ModelSettings, useGenerationState } from './nodes/ImageGenerationNode';
import { StatusChip } from './nodes/parts';

export function Toolbar({ historyOpen, onToggleHistory, node }: { historyOpen: boolean; onToggleHistory: () => void; node: AppNode | null }) {
  const undo = useBoard((s) => s.undo);
  const redo = useBoard((s) => s.redo);
  const canUndo = useBoard((s) => s.past.length > 0);
  const canRedo = useBoard((s) => s.future.length > 0);
  const run = useBoard((s) => s.run);
  const running = useBoard((s) => s.running);
  const cancelRun = useBoard((s) => s.cancelRun);
  const { fitView } = useReactFlow();
  // Only Image Generation nodes produce anything today, so the other kinds have nothing to run on their own.
  const runnable = !node || node.type === 'imageGeneration';
  return (
    <div className="panel toolbar" role="toolbar" aria-label="Workflow actions">
      <button className="icon-btn" onClick={() => void fitView(FIT_OPTIONS)} title="Fit workflow (Shift+1)" aria-label="Fit workflow to screen">
        <Scan size={18} />
      </button>
      <button className="icon-btn" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
        <Undo2 size={18} />
      </button>
      <button className="icon-btn" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
        <Redo2 size={18} />
      </button>
      <button className={`icon-btn ${historyOpen ? 'is-on' : ''}`} onClick={onToggleHistory} aria-pressed={historyOpen} title="Run history and spend" aria-label="Run history">
        <History size={18} />
      </button>
      <button className="icon-btn" onClick={exportWorkflow} title="Export workflow as JSON" aria-label="Export workflow">
        <Download size={18} />
      </button>
      <span className="toolbar__sep" aria-hidden />
      {running ? (
        <button className="primary-btn primary-btn--ghost" onClick={cancelRun}>
          <Square size={13} fill="currentColor" /> Stop
        </button>
      ) : (
        <button
          className="primary-btn"
          disabled={!runnable}
          onClick={() => void run(node?.id)}
          title={runnable ? (node ? 'Run this node and anything it depends on (Ctrl+Enter)' : 'Run workflow (Ctrl+Enter)') : 'This node has nothing to run on its own'}
        >
          <Play size={14} fill="currentColor" /> {node ? 'Run Node' : 'Run Workflow'}
        </button>
      )}
    </div>
  );
}

function formatTokens(u: Record<string, number>, cost?: number) {
  const parts = [`${u.totalTokens.toLocaleString()} tokens`];
  if (cost !== undefined) parts.unshift(`≈ ${formatUsd(cost)}`);
  if (u.inputTokens !== undefined) parts.push(`${u.inputTokens.toLocaleString()} in`);
  if (u.outputTokens !== undefined) parts.push(`${u.outputTokens.toLocaleString()} out`);
  return parts.join(' · ');
}

const STATUS_LABEL: Record<NodeExecutionView['status'], string> = {
  succeeded: 'Succeeded',
  failed: 'Failed',
  canceled: 'Canceled',
  queued: 'Queued',
  running: 'Running',
};

function ActivityList({ entries }: { entries: NodeExecutionView[] }) {
  if (!entries.length) return <p className="muted small">No runs yet. Press Run to generate.</p>;
  return (
    <ol className="activity">
      {entries.map((a) => (
        <li key={a.id} className={`activity__item activity__item--${a.status}`}>
          <div className="activity__top">
            <strong>{a.nodeTitle}</strong>
            <span>{a.endedAt ? new Date(a.endedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : ''}</span>
          </div>
          <div className="activity__msg">
            <span className="activity__status">{STATUS_LABEL[a.status]}</span>
            {' · '}
            {a.status === 'succeeded'
              ? `${a.outputs.length} image${a.outputs.length === 1 ? '' : 's'} from ${a.request?.model ?? 'model'}${a.request?.provider === 'simulated' ? ' (simulated)' : ''}`
              : a.error}
          </div>
          {a.status === 'succeeded' && a.outputs.length ? (
            <div className="activity__thumbs">
              {a.outputs.map((o) => (
                <img key={o.id} src={o.thumb ?? o.src} alt="" />
              ))}
            </div>
          ) : null}
          {a.usage?.totalTokens ? (
            <div className="activity__run">
              {formatTokens(a.usage, a.costUsd)}
            </div>
          ) : null}
          <div className="activity__run">
            Run {a.runId}
            {a.startedAt && a.endedAt ? ` · ${((a.endedAt - a.startedAt) / 1000).toFixed(1)}s` : ''}
          </div>
        </li>
      ))}
    </ol>
  );
}

function RunLine({ status, lastRunAt, costUsd }: { status: RunStatus | 'stale'; lastRunAt?: number; costUsd?: number }) {
  return (
    <div className="insp-status">
      <StatusChip status={status} />
      <span className="muted small">
        Last run {new Date(lastRunAt!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        {costUsd !== undefined ? ` · ≈ ${formatUsd(costUsd)}` : ''}
      </span>
    </div>
  );
}

function GenerationProps({ node }: { node: GenNode }) {
  const selectOutput = useBoard((s) => s.selectOutput);
  const updateData = useBoard((s) => s.updateData);
  const { status } = useGenerationState(node);
  const out = selectedOutput(node);
  const d = node.data;
  const lastCost = useBoard((s) => s.activity.find((a) => a.nodeId === node.id && a.costUsd !== undefined)?.costUsd);
  return (
    <>
      {d.lastRunAt ? <RunLine status={status} lastRunAt={d.lastRunAt} costUsd={lastCost} /> : null}
      <ModelSettings node={node} idPrefix="i" />
      <div className="field">
        <label className="field-label" htmlFor="i-prompt">
          Prompt
        </label>
        <textarea id="i-prompt" className="nt-textarea" rows={5} placeholder="Describe the image you want…" value={d.prompt} onChange={(e) => updateData(node.id, { prompt: e.target.value })} />
      </div>
      <div className="field">
        <span className="field-label">Output</span>
        {out ? (
          <>
            <a href={out.src} target="_blank" rel="noreferrer" title="Open full size">
              <img className="insp-output" src={out.src} alt="Selected output" />
            </a>
            {out.provider === 'simulated' ? <p className="muted small">Simulated preview, no model was called. Add an OpenAI API key to generate real images.</p> : null}
            <div className="insp-output-meta">
              <span>
                {out.width}×{out.height} · {d.model} · {new Date(out.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
              <a className="link-btn" href={out.src} download={out.name}>
                <Download size={14} /> Download
              </a>
            </div>
            {d.outputs.length > 1 ? (
              <div className="versions">
                {d.outputs.map((o, i) => (
                  <button
                    key={o.id}
                    className={`version ${o.id === out.id ? 'is-active' : ''}`}
                    onClick={() => selectOutput(node.id, o.id)}
                    aria-label={`Use version ${d.outputs.length - i}`}
                    aria-pressed={o.id === out.id}
                  >
                    <img src={o.thumb ?? o.src} alt="" />
                    <span>v{d.outputs.length - i}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <p className="muted small">Nothing generated yet.</p>
        )}
      </div>
    </>
  );
}

const REMOVE_MS = 240;

function ImageInputProps({ node }: { node: ImageInputNode }) {
  const updateData = useBoard((s) => s.updateData);
  const importFiles = useImageImport(node.id);
  const [removing, setRemoving] = useState<Set<string>>(new Set());
  const remove = (id: string) => {
    setRemoving((r) => new Set(r).add(id));
    // Let the exit animation play, then drop the image from the node.
    setTimeout(() => {
      const cur = useBoard.getState().nodes.find((n) => n.id === node.id);
      if (cur?.type === 'imageInput') updateData(node.id, { images: cur.data.images.filter((i) => i.id !== id) }, `rm:${id}`);
      setRemoving((r) => {
        const n = new Set(r);
        n.delete(id);
        return n;
      });
    }, REMOVE_MS);
  };
  return (
    <>
      <label className="secondary-btn">
        <Upload size={15} /> Upload images
        <input
          type="file"
          hidden
          multiple
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={(e) => {
            if (e.target.files) void importFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </label>
      {node.data.images.length ? (
        <ul className="insp-images" aria-label="Images">
          {node.data.images.map((img) => (
            <li key={img.id} className={removing.has(img.id) ? 'is-removing' : ''}>
              <div className="insp-images__row">
                <img src={img.thumb ?? img.src} alt="" />
                <span title={img.name}>{img.name}</span>
                <button className="icon-btn icon-btn--sm" aria-label={`Remove ${img.name}`} disabled={removing.has(img.id)} onClick={() => remove(img.id)}>
                  <Trash2 size={14} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">No images yet.</p>
      )}
    </>
  );
}

function PromptProps({ node }: { node: PromptNode }) {
  const updateData = useBoard((s) => s.updateData);
  return (
    <>
      <div className="field">
        <label className="field-label" htmlFor="i-pmodel">
          Model
        </label>
        <input id="i-pmodel" className="nt-input" placeholder="Model name" value={node.data.model ?? ''} onChange={(e) => updateData(node.id, { model: e.target.value })} />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="i-text">
          Prompt
        </label>
        <textarea id="i-text" className="nt-textarea" rows={8} value={node.data.text} onChange={(e) => updateData(node.id, { text: e.target.value })} />
      </div>
    </>
  );
}

function NodePanel({ node }: { node: AppNode }) {
  const updateData = useBoard((s) => s.updateData);
  return (
    <aside className="panel inspector" aria-label={`${node.data.title} properties`}>
      <div className="insp-head">
        <NodeIconTile kind={node.type!} size="lg" />
        <div className="insp-head__text">
          <input
            className="insp-head__title"
            aria-label="Node name"
            value={node.data.title}
            onChange={(e) => updateData(node.id, { title: e.target.value }, `title:${node.id}`)}
            onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          />
          <div className="insp-head__sub">{CATALOG[node.type!].label}</div>
        </div>
      </div>
      <div className="inspector__scroll">
        <div className="insp-body">
          {node.type === 'prompt' ? <PromptProps node={node} /> : null}
          {node.type === 'imageInput' ? <ImageInputProps node={node} /> : null}
          {node.type === 'imageGeneration' ? <GenerationProps node={node} /> : null}
        </div>
      </div>
    </aside>
  );
}

function WorkflowOverview() {
  const provider = useBoard((s) => s.provider);
  const nodes = useBoard((s) => s.nodes);
  const edges = useBoard((s) => s.edges);
  const select = useBoard((s) => s.select);
  const spend = useBoard((s) => s.spend);
  const setSettingsOpen = useBoard((s) => s.setSettingsOpen);
  const issues = validateGraph(nodes, edges);
  return (
    <>
      <dl className="stats">
        <div>
          <dt>Nodes</dt>
          <dd>{nodes.length}</dd>
        </div>
        <div>
          <dt>Connections</dt>
          <dd>{edges.length}</dd>
        </div>
        <div>
          <dt>Generations</dt>
          <dd>{nodes.filter((n) => n.type === 'imageGeneration').length}</dd>
        </div>
      </dl>
      <span className="field-label">Image provider</span>
      {provider?.id === 'simulated' ? (
        <p className="provider-hint">
          <strong>Simulated.</strong> No model is called and nothing is charged. To generate real images,{' '}
          <button className="inline-link" onClick={() => setSettingsOpen(true)}>
            add your OpenAI API key in Account settings
          </button>
          .
        </p>
      ) : (
        <p className="muted small">{provider ? `${provider.label}, using the API key on this computer.` : 'Unknown'}</p>
      )}
      <span className="field-label">Estimated spend</span>
      <dl className="stats stats--two">
        <div>
          <dt>This workflow</dt>
          <dd>{formatUsd(spend.board)}</dd>
        </div>
        <div>
          <dt>Today, all workflows</dt>
          <dd>{formatUsd(spend.today)}</dd>
        </div>
      </dl>
      <p className="muted small">
        Worked out from the tokens OpenAI reports and its published prices. Your{' '}
        <a href="https://platform.openai.com/usage" target="_blank" rel="noreferrer">
          OpenAI usage page
        </a>{' '}
        has the exact bill.
      </p>
      <span className="field-label">Before you run</span>
      {issues.length ? (
        <ul className="issues">
          {issues.map((i, k) => (
            <li key={k}>
              <button onClick={() => select(i.nodeId)}>{i.message}</button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">{nodes.length ? 'Everything needed to run is connected.' : 'The board is empty.'}</p>
      )}
      <span className="field-label">Runs</span>
    </>
  );
}

/** Floating right-hand controls. Collapsed to the toolbar unless exactly one node is selected (or history is open). */
export function Inspector() {
  const selected = useBoard(useShallow((s) => s.nodes.filter((n) => n.selected)));
  const activity = useBoard((s) => s.activity);
  const [historyOpen, setHistoryOpen] = useState(false);
  const node = selected.length === 1 ? selected[0] : null;

  return (
    <div className="inspector-stack">
      <Toolbar historyOpen={historyOpen} onToggleHistory={() => setHistoryOpen(!historyOpen)} node={node} />
      {historyOpen ? (
        <aside className="panel inspector" aria-label="Run history">
          <div className="insp-head">
            <div className="insp-head__text">
              <div className="insp-head__title insp-head__title--static">Run history</div>
              <div className="insp-head__sub">All nodes</div>
            </div>
            <button className="icon-btn icon-btn--sm" onClick={() => setHistoryOpen(false)} aria-label="Close history">
              <X size={16} />
            </button>
          </div>
          <div className="inspector__scroll">
            <div className="insp-body">
              <WorkflowOverview />
              <ActivityList entries={activity} />
            </div>
          </div>
        </aside>
      ) : node ? (
        <NodePanel key={node.id} node={node} />
      ) : null}
    </div>
  );
}
