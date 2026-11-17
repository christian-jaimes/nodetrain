import { useReactFlow } from '@xyflow/react';
import { ChevronDown, Download, Hand, History, Play, Redo2, Scan, Square, SquareDashedMousePointer, Trash2, Undo2, Upload } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { CATALOG } from '../../shared/graph/catalog';
import { formatUsd } from '../../shared/graph/models';
import { FIT_OPTIONS } from '../lib/ui';
import { TRANSFORMS, defaultOptions, getTransform, normalizeOptions, type TransformParam } from '../../shared/graph/transforms';
import { isRunnable, type AppNode, type ImageGenerationNode as GenNode, type ImageInputNode, type ImageTransformNode as TransformNode, type PromptNode } from '../../shared/graph/types';
import { selectedOutput } from '../../shared/graph/validate';
import type { NodeExecutionView } from '../../shared/api';
import { exportWorkflow, useBoard } from '../store/board';
import { NodeIconTile } from './icons';
import { useImageImport } from './nodes/ImageInputNode';
import { ModelSettings, Select, useGenerationState } from './nodes/ImageGenerationNode';
import { useTransformStatus } from './nodes/ImageTransformNode';
import { OutputGallery, StatusChip } from './nodes/parts';

function RunButton({ node }: { node: AppNode | null }) {
  const run = useBoard((s) => s.run);
  const running = useBoard((s) => s.running);
  const cancelRun = useBoard((s) => s.cancelRun);
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e: Event) => {
      if (e.type === 'keydown' ? (e as KeyboardEvent).key === 'Escape' : !ref.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [menu]);
  if (running) {
    return (
      <button className="primary-btn primary-btn--ghost" onClick={cancelRun}>
        <Square size={13} fill="currentColor" /> Stop
      </button>
    );
  }
  if (!node) {
    return (
      <button className="primary-btn" onClick={() => void run()} title="Run the whole workflow (Ctrl+Enter)">
        <Play size={14} fill="currentColor" /> Run Workflow
      </button>
    );
  }
  // Only Image Generation and Image Transformation nodes produce anything, so other kinds have nothing to run on their own.
  const runnable = isRunnable(node);
  return (
    <div className="split-btn" ref={ref}>
      <button className="primary-btn split-btn__main" disabled={!runnable} onClick={() => void run(node.id, false)} title={runnable ? 'Run only this node (Ctrl+Enter)' : 'This node has nothing to run on its own'}>
        <Play size={14} fill="currentColor" /> Run Node
      </button>
      <button className="primary-btn split-btn__caret" disabled={!runnable} aria-haspopup="menu" aria-expanded={menu} aria-label="More run options" onClick={() => setMenu(!menu)}>
        <ChevronDown size={16} />
      </button>
      {menu ? (
        <div className="split-btn__menu" role="menu">
          <button
            role="menuitem"
            onClick={() => {
              setMenu(false);
              void run(node.id, true);
            }}
          >
            Run node + upstream nodes
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Toolbar({ historyOpen, onToggleHistory, node }: { historyOpen: boolean; onToggleHistory: () => void; node: AppNode | null }) {
  const undo = useBoard((s) => s.undo);
  const redo = useBoard((s) => s.redo);
  const canUndo = useBoard((s) => s.past.length > 0);
  const canRedo = useBoard((s) => s.future.length > 0);
  const tool = useBoard((s) => s.tool);
  const setTool = useBoard((s) => s.setTool);
  const { fitView } = useReactFlow();
  return (
    <div className="toolbar" role="toolbar" aria-label="Workflow actions">
      <button
        className={`icon-btn ${tool === 'select' ? 'is-on' : ''}`}
        onClick={() => setTool(tool === 'move' ? 'select' : 'move')}
        title={tool === 'move' ? 'Move tool: drag to pan. Click, or press V, for the select tool' : 'Select tool: drag to select nodes. Click, or press H, for the move tool'}
        aria-label={tool === 'move' ? 'Move tool active. Switch to select tool' : 'Select tool active. Switch to move tool'}
      >
        {tool === 'move' ? <Hand size={18} /> : <SquareDashedMousePointer size={18} />}
      </button>
      <button className="icon-btn" onClick={() => void fitView(FIT_OPTIONS)} title="Fit workflow (Shift+1)" aria-label="Fit workflow to screen">
        <Scan size={18} />
      </button>
      <button className="icon-btn" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
        <Undo2 size={18} />
      </button>
      <button className="icon-btn" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
        <Redo2 size={18} />
      </button>
      <button className={`icon-btn ${historyOpen ? 'is-on' : ''}`} onClick={onToggleHistory} aria-pressed={historyOpen} title="Run history" aria-label="Run history">
        <History size={18} />
      </button>
      <button className="icon-btn" onClick={exportWorkflow} title="Export workflow as JSON" aria-label="Export workflow">
        <Download size={18} />
      </button>
      <span className="toolbar__sep" aria-hidden />
      <RunButton node={node} />
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
              ? a.request?.provider === 'local'
                ? `${a.request.model}: ${a.outputs.length} image${a.outputs.length === 1 ? '' : 's'}`
                : `${a.outputs.length} image${a.outputs.length === 1 ? '' : 's'} from ${a.request?.model ?? 'model'}${a.request?.provider === 'simulated' ? ' (simulated)' : ''}`
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

/** Status badge for the header row, beside the node name. */
function GenStatus({ node }: { node: GenNode }) {
  const { status } = useGenerationState(node);
  return <StatusChip status={status} />;
}

function TransformStatus({ node }: { node: TransformNode }) {
  return <StatusChip status={useTransformStatus(node)} runningLabel="Editing…" />;
}

/** Last run time and cost, on the node type row. */
function GenLastRun({ node }: { node: GenNode | TransformNode }) {
  const lastCost = useBoard((s) => s.activity.find((a) => a.nodeId === node.id && a.costUsd !== undefined)?.costUsd);
  const at = node.data.lastRunAt;
  if (!at) return null;
  return (
    <span className="small">
      Last run {new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
      {lastCost !== undefined ? ` · ≈ ${formatUsd(lastCost)}` : ''}
    </span>
  );
}

function GenerationProps({ node }: { node: GenNode }) {
  const updateData = useBoard((s) => s.updateData);
  const { inputs, connectedPrompts } = useGenerationState(node);
  const d = node.data;
  return (
    <>
      <div className="field">
        <label className="field-label" htmlFor="i-prompt">
          {connectedPrompts ? 'Additional prompt' : 'Prompt'}
        </label>
        <textarea
          id="i-prompt"
          className="nt-textarea"
          rows={5}
          placeholder={connectedPrompts ? 'Added after the connected prompt…' : 'Describe the image you want…'}
          value={d.prompt}
          onChange={(e) => updateData(node.id, { prompt: e.target.value })}
        />
        <p className="muted small">
          {connectedPrompts ? `${connectedPrompts} prompt${connectedPrompts > 1 ? 's' : ''} connected` : 'No prompt connected'} ·{' '}
          {inputs.references.length ? `${inputs.references.length} reference image${inputs.references.length > 1 ? 's' : ''}` : 'No reference images'}
        </p>
      </div>
      <ModelSettings node={node} idPrefix="i" />
      {d.status === 'failed' && d.error ? (
        <p className="node-error" role="alert">
          {d.error}
        </p>
      ) : null}
      <OutputField node={node} empty="Nothing generated yet." />
      {d.outputs.some((o) => o.provider === 'simulated') ? <p className="muted small">Simulated preview, no model was called. Add an OpenAI API key to generate real images.</p> : null}
    </>
  );
}

function OptionField({ node, param }: { node: TransformNode; param: TransformParam }) {
  const updateData = useBoard((s) => s.updateData);
  const value = normalizeOptions(node.data.operation, node.data.options)[param.id];
  const set = (v: number | string) => updateData(node.id, { options: { ...node.data.options, [param.id]: v } }, `opt:${node.id}:${param.id}`);
  const id = `i-opt-${param.id}`;
  if (param.type === 'select') {
    return (
      <>
        <Select id={id} label={param.label} value={String(value)} options={param.options} onChange={set} />
        {param.hint ? <p className="muted small">{param.hint}</p> : null}
      </>
    );
  }
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {param.label}
        {param.unit ? ` (${param.unit})` : ''}
      </label>
      <div className="range-row">
        {param.max - param.min <= 200 ? (
          <input className="nodrag" type="range" aria-label={param.label} min={param.min} max={param.max} step={param.step ?? 1} value={Number(value)} onChange={(e) => set(Number(e.target.value))} />
        ) : null}
        <input
          id={id}
          className="nt-input range-row__num"
          type="number"
          min={param.min}
          max={param.max}
          step={param.step ?? 1}
          value={Number(value)}
          onChange={(e) => e.target.value !== '' && set(Number(e.target.value))}
          onBlur={(e) => set(Math.min(param.max, Math.max(param.min, Number(e.target.value) || param.default)))}
        />
      </div>
      {param.hint ? <p className="muted small">{param.hint}</p> : null}
    </div>
  );
}

function OutputField({ node, empty }: { node: GenNode | TransformNode; empty: string }) {
  const selectOutput = useBoard((s) => s.selectOutput);
  const d = node.data;
  const out = selectedOutput(node);
  return (
    <div className="field">
      <span className="field-label">Output</span>
      {d.outputs.length ? (
        <>
          <OutputGallery fit="natural" images={d.outputs} selectedId={d.selectedOutputId} onSelect={(oid) => selectOutput(node.id, oid)} alt={() => 'Output'} />
          {d.outputs.length > 1 ? (
            <p className="muted small">
              {out ? 'Only the selected image is passed on. Click it again to pass on all.' : 'Select an image to pass on only it. With none selected, all are passed on.'}
            </p>
          ) : null}
          <a className="secondary-btn" href={(out ?? d.outputs[0]).src} download={(out ?? d.outputs[0]).name}>
            <Download size={15} /> Download {out ? 'selected' : d.outputs.length > 1 ? 'latest' : 'image'}
          </a>
        </>
      ) : (
        <p className="muted small">{empty}</p>
      )}
    </div>
  );
}

function TransformProps({ node }: { node: TransformNode }) {
  const updateData = useBoard((s) => s.updateData);
  const nodes = useBoard((s) => s.nodes);
  const edges = useBoard((s) => s.edges);
  const d = node.data;
  const def = getTransform(d.operation);
  const incoming = edges.filter((e) => e.target === node.id).length;
  const outputOf = (n: (typeof nodes)[number]) => (isRunnable(n) ? n.data.outputs.length : n.type === 'imageInput' ? n.data.images.length : 0);
  const available = edges.filter((e) => e.target === node.id).reduce((sum, e) => sum + outputOf(nodes.find((n) => n.id === e.source)!), 0);
  return (
    <>
      <Select
        id="i-op"
        label="Operation"
        value={d.operation}
        options={TRANSFORMS.map((t) => ({ value: t.id, label: t.label }))}
        onChange={(v) => updateData(node.id, { operation: v, options: defaultOptions(v) })}
      />
      {def ? <p className="muted small">{def.description}</p> : null}
      {def?.params.map((p) => (
        <OptionField key={`${d.operation}-${p.id}`} node={node} param={p} />
      ))}
      <p className="muted small">
        {incoming ? `${incoming} input${incoming > 1 ? 's' : ''} connected` : 'Nothing connected'}
        {incoming && available ? ` · ${available} image${available > 1 ? 's' : ''} ready` : ''}. Runs on this computer, so it costs nothing.
      </p>
      {d.status === 'failed' && d.error ? (
        <p className="node-error" role="alert">
          {d.error}
        </p>
      ) : null}
      <OutputField node={node} empty="Nothing edited yet." />
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

function NodeBody({ node }: { node: AppNode }) {
  const updateData = useBoard((s) => s.updateData);
  return (
    <>
      <div className="insp-head">
        <NodeIconTile kind={node.type!} size="lg" />
        <div className="insp-head__text">
          <div className="insp-head__line">
            <input
              className="insp-head__title"
              aria-label="Node name"
              value={node.data.title}
              onChange={(e) => updateData(node.id, { title: e.target.value }, `title:${node.id}`)}
              onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
            {node.type === 'imageGeneration' ? <GenStatus node={node} /> : null}
            {node.type === 'imageTransform' ? <TransformStatus node={node} /> : null}
          </div>
          <div className="insp-head__line insp-head__sub">
            <span>{CATALOG[node.type!].label}</span>
            {isRunnable(node) ? <GenLastRun node={node} /> : null}
          </div>
        </div>
      </div>
      <div className="insp-body">
        {node.type === 'prompt' ? <PromptProps node={node} /> : null}
        {node.type === 'imageInput' ? <ImageInputProps node={node} /> : null}
        {node.type === 'imageGeneration' ? <GenerationProps node={node} /> : null}
        {node.type === 'imageTransform' ? <TransformProps node={node} /> : null}
      </div>
    </>
  );
}

const PAGE = 15;

function HistoryBody({ node }: { node: AppNode | null }) {
  const activity = useBoard((s) => s.activity);
  const spend = useBoard((s) => s.spend);
  const stats = node ? (spend.byNode[node.id] ?? { generations: 0, textUsd: 0, imageUsd: 0 }) : spend.all;
  const entries = useMemo(() => (node ? activity.filter((a) => a.nodeId === node.id) : activity), [activity, node]);
  const [shown, setShown] = useState(PAGE);
  const [sentinel, setSentinel] = useState<HTMLDivElement | null>(null);
  // Reveal the next page when the end of the list scrolls into view.
  useEffect(() => {
    if (!sentinel) return;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && setShown((n) => n + PAGE), { rootMargin: '120px' });
    io.observe(sentinel);
    return () => io.disconnect();
  }, [sentinel, shown]);
  return (
    <>
      <div className="insp-head insp-head--history">
        <div className="insp-head__title insp-head__title--static">{node ? node.data.title : 'All nodes'}</div>
        <div className="insp-head__sub insp-head__sub--right">Run History</div>
      </div>
      <div className="insp-body">
        <dl className="stats ban">
          <div>
            <dt>Generations</dt>
            <dd>{stats.generations}</dd>
          </div>
          <div>
            <dt>Text spend</dt>
            <dd>{formatUsd(stats.textUsd)}</dd>
          </div>
          <div>
            <dt>Image spend</dt>
            <dd>{formatUsd(stats.imageUsd)}</dd>
          </div>
        </dl>
        <span className="field-label">Run log</span>
        <ActivityList entries={entries.slice(0, shown)} />
        {shown < entries.length ? <div ref={setSentinel} className="log-sentinel" aria-hidden /> : null}
      </div>
    </>
  );
}

/**
 * One floating panel: the toolbar is its fixed top row and the body drops down beneath it. The body opens for a single
 * selected node or for run history, and folds away when nothing (or several nodes) is selected.
 */
export function Inspector() {
  const selected = useBoard(useShallow((s) => s.nodes.filter((n) => n.selected)));
  const historyOpen = useBoard((s) => s.historyOpen);
  const setHistoryOpen = useBoard((s) => s.setHistoryOpen);
  const node = selected.length === 1 ? selected[0] : null;
  const multi = selected.length > 1;
  useEffect(() => {
    if (multi) setHistoryOpen(false);
  }, [multi, setHistoryOpen]);
  const kind: 'history' | 'node' | null = multi ? null : historyOpen ? 'history' : node ? 'node' : null;
  // Keep the last content mounted while the body folds away.
  const [last, setLast] = useState<{ kind: 'history' | 'node'; nodeId: string | null }>({ kind: 'node', nodeId: null });
  const wanted = kind && { kind, nodeId: node?.id ?? last.nodeId };
  if (wanted && (wanted.kind !== last.kind || (node && wanted.nodeId !== last.nodeId))) setLast({ kind: wanted.kind, nodeId: node?.id ?? last.nodeId });
  const showKind = kind ?? last.kind;
  const remembered = useBoard((s) => s.nodes.find((n) => n.id === last.nodeId) ?? null);
  const bodyNode = showKind === 'node' ? (node ?? remembered) : node;

  return (
    <aside className="panel rightbar" aria-label="Workflow controls">
      <Toolbar historyOpen={historyOpen && !multi} onToggleHistory={() => setHistoryOpen(!historyOpen)} node={node} />
      <div className={`rightbar__drop ${kind ? 'is-open' : ''}`} inert={!kind}>
        <div className="rightbar__clip">
          <div className="rightbar__scroll">
            {showKind === 'history' ? <HistoryBody key={bodyNode?.id ?? 'all'} node={bodyNode} /> : bodyNode ? <NodeBody key={bodyNode.id} node={bodyNode} /> : null}
          </div>
        </div>
      </div>
    </aside>
  );
}
