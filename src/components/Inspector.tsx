import { useReactFlow } from '@xyflow/react';
import { ChevronDown, Download, History, Play, Redo2, Scan, Square, Trash2, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ASPECT_RATIOS, CATALOG, FIT_OPTIONS, IMAGE_MODELS, QUALITIES } from '../graph/catalog';
import type { AppNode, ImageGenerationNode as GenNode } from '../graph/types';
import { selectedOutput, validateGraph } from '../graph/validate';
import { exportWorkflow, useBoard, type ActivityEntry } from '../store/board';
import { NodeIconTile } from './icons';
import { useImageImport } from './nodes/ImageInputNode';
import { Select, useGenerationState } from './nodes/ImageGenerationNode';
import { StatusChip } from './nodes/parts';

export function Toolbar({ onShowActivity }: { onShowActivity: () => void }) {
  const undo = useBoard((s) => s.undo);
  const redo = useBoard((s) => s.redo);
  const canUndo = useBoard((s) => s.past.length > 0);
  const canRedo = useBoard((s) => s.future.length > 0);
  const run = useBoard((s) => s.run);
  const running = useBoard((s) => s.running);
  const cancelRun = useBoard((s) => s.cancelRun);
  const { fitView } = useReactFlow();
  return (
    <div className="toolbar">
      <button className="icon-btn" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
        <Undo2 size={18} />
      </button>
      <button className="icon-btn" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
        <Redo2 size={18} />
      </button>
      <button className="icon-btn" onClick={() => void fitView(FIT_OPTIONS)} title="Fit workflow (Shift+1)" aria-label="Fit workflow to screen">
        <Scan size={18} />
      </button>
      <button className="icon-btn" onClick={exportWorkflow} title="Export workflow as JSON" aria-label="Export workflow">
        <Download size={18} />
      </button>
      <button className="icon-btn" onClick={onShowActivity} title="Run history" aria-label="Run history">
        <History size={18} />
      </button>
      {running ? (
        <button className="primary-btn primary-btn--ghost" onClick={cancelRun}>
          <Square size={13} fill="currentColor" /> Stop
        </button>
      ) : (
        <button className="primary-btn" onClick={() => void run()} title="Run workflow (Ctrl+Enter)">
          <Play size={14} fill="currentColor" /> Run workflow
        </button>
      )}
    </div>
  );
}

function ActivityList({ entries }: { entries: ActivityEntry[] }) {
  if (!entries.length) return <p className="muted small">No runs yet. Press Run to generate.</p>;
  return (
    <ol className="activity">
      {entries.map((a) => (
        <li key={a.id} className={`activity__item activity__item--${a.status}`}>
          <div className="activity__top">
            <strong>{a.title}</strong>
            <span>{new Date(a.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
          </div>
          <div className="activity__msg">
            <span className="activity__status">{a.status === 'succeeded' ? 'Succeeded' : a.status === 'failed' ? 'Failed' : 'Canceled'}</span> · {a.message}
          </div>
          <div className="activity__run">Run {a.runId}</div>
        </li>
      ))}
    </ol>
  );
}

function GenerationProps({ node }: { node: GenNode }) {
  const updateData = useBoard((s) => s.updateData);
  const selectOutput = useBoard((s) => s.selectOutput);
  const { inputs, status } = useGenerationState(node);
  const [open, setOpen] = useState(true);
  const out = selectedOutput(node);
  const d = node.data;
  return (
    <>
      <div className="insp-status">
        <StatusChip status={status} />
        {d.lastRunAt ? <span className="muted small">Last run {new Date(d.lastRunAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span> : null}
      </div>
      <div className="field">
        <span className="field-label">Prompt sent to the model</span>
        {inputs.promptParts.length ? (
          <ol className="prompt-parts">
            {inputs.promptParts.map((p, i) => (
              <li key={i}>
                <span className="prompt-parts__from">{p.from}</span>
                {p.text}
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted small">No prompt yet.</p>
        )}
      </div>
      <Select id="i-model" label="Model" value={d.model} options={IMAGE_MODELS} onChange={(v) => updateData(node.id, { model: v })} />
      <div className="field-row">
        <Select id="i-aspect" label="Aspect ratio" value={d.aspectRatio} options={ASPECT_RATIOS} onChange={(v) => updateData(node.id, { aspectRatio: v })} />
        <Select id="i-quality" label="Quality" value={d.quality} options={QUALITIES} onChange={(v) => updateData(node.id, { quality: v })} />
      </div>
      <p className="muted small">References: {inputs.references.length || 'none'}</p>

      <button className="section-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <ChevronDown size={16} className={open ? '' : 'rot'} /> Output
      </button>
      {open &&
        (out ? (
          <>
            <img className="insp-output" src={out.src} alt="Selected output" />
            <div className="insp-output-meta">
              <span>
                {out.width}×{out.height} · {d.model} · {new Date(out.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
              <a className="link-btn" href={out.src} download={out.name}>
                <Download size={14} /> Download
              </a>
            </div>
            {d.outputs.length > 1 ? (
              <>
                <span className="field-label">Versions ({d.outputs.length})</span>
                <div className="versions">
                  {d.outputs.map((o, i) => (
                    <button
                      key={o.id}
                      className={`version ${o.id === out.id ? 'is-active' : ''}`}
                      onClick={() => selectOutput(node.id, o.id)}
                      aria-label={`Use version ${d.outputs.length - i}`}
                      aria-pressed={o.id === out.id}
                    >
                      <img src={o.src} alt="" />
                      <span>v{d.outputs.length - i}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : null}
          </>
        ) : (
          <p className="muted small">Nothing generated yet.</p>
        ))}
    </>
  );
}

function NodeProperties({ node }: { node: AppNode }) {
  const updateData = useBoard((s) => s.updateData);
  const importFiles = useImageImport(node.id);
  return (
    <div className="insp-body">
      <div className="field">
        <label className="field-label" htmlFor="i-title">
          Name
        </label>
        <input id="i-title" className="nt-input" value={node.data.title} onChange={(e) => updateData(node.id, { title: e.target.value })} />
      </div>
      {node.type === 'prompt' ? (
        <div className="field">
          <label className="field-label" htmlFor="i-text">
            Text
          </label>
          <textarea id="i-text" className="nt-textarea" rows={8} value={node.data.text} onChange={(e) => updateData(node.id, { text: e.target.value })} />
        </div>
      ) : null}
      {node.type === 'imageInput' ? (
        <div className="field">
          <span className="field-label">Images ({node.data.images.length})</span>
          <div className="insp-images">
            {node.data.images.map((img) => (
              <figure key={img.id}>
                <img src={img.src} alt={img.name} />
                <figcaption>
                  <span title={img.name}>{img.name}</span>
                  <button
                    className="icon-btn icon-btn--sm"
                    aria-label={`Remove ${img.name}`}
                    onClick={() => node.type === 'imageInput' && updateData(node.id, { images: node.data.images.filter((i) => i.id !== img.id) }, `rm:${img.id}`)}
                  >
                    <Trash2 size={14} />
                  </button>
                </figcaption>
              </figure>
            ))}
          </div>
          <label className="secondary-btn">
            Upload images
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
        </div>
      ) : null}
      {node.type === 'imageGeneration' ? <GenerationProps node={node} /> : null}
    </div>
  );
}

function WorkflowOverview() {
  const nodes = useBoard((s) => s.nodes);
  const edges = useBoard((s) => s.edges);
  const select = useBoard((s) => s.select);
  const issues = validateGraph(nodes, edges);
  return (
    <div className="insp-body">
      <p className="muted small">Select a node to edit it. Double-click the canvas, or drag out of a port, to add one.</p>
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
    </div>
  );
}

export function Inspector({ tab, setTab }: { tab: 'properties' | 'activity'; setTab: (t: 'properties' | 'activity') => void }) {
  const selected = useBoard(useShallow((s) => s.nodes.filter((n) => n.selected)));
  const activity = useBoard((s) => s.activity);
  const node = selected.length === 1 ? selected[0] : null;
  const entries = node ? activity.filter((a) => a.nodeId === node.id) : activity;

  return (
    <aside className="panel inspector" aria-label="Inspector">
      <Toolbar onShowActivity={() => setTab('activity')} />
      <div className="inspector__inner">
        <h2 className="inspector__title">Inspector</h2>
        <div className="insp-head">
          {node ? (
            <>
              <NodeIconTile kind={node.type!} size="lg" />
              <div>
                <div className="insp-head__title">{node.data.title}</div>
                <div className="insp-head__sub">{CATALOG[node.type!].label}</div>
              </div>
            </>
          ) : (
            <div>
              <div className="insp-head__title">{selected.length > 1 ? `${selected.length} nodes selected` : 'Workflow'}</div>
              <div className="insp-head__sub">{selected.length > 1 ? 'Ctrl+D to duplicate, Delete to remove' : 'Overview'}</div>
            </div>
          )}
        </div>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={tab === 'properties'} className={tab === 'properties' ? 'is-active' : ''} onClick={() => setTab('properties')}>
            Properties
          </button>
          <button role="tab" aria-selected={tab === 'activity'} className={tab === 'activity' ? 'is-active' : ''} onClick={() => setTab('activity')}>
            Activity
          </button>
        </div>
        <div className="inspector__scroll">
          {tab === 'activity' ? (
            <div className="insp-body">
              <ActivityList entries={entries} />
            </div>
          ) : node ? (
            <NodeProperties key={node.id} node={node} />
          ) : (
            <WorkflowOverview />
          )}
        </div>
      </div>
    </aside>
  );
}
