import type { NodeProps } from '@xyflow/react';
import { Play, Sparkles } from 'lucide-react';
import { aspectSize } from '../../../shared/graph/catalog';
import { ASPECT_RATIOS, IMAGE_MODEL_LIST, apiSize, formatDate, getModel, settingsIssues, shutdownNotice } from '../../../shared/graph/models';
import type { ImageGenerationNode as GenNode } from '../../../shared/graph/types';
import { isStale, resolveInputs, selectedOutput } from '../../../shared/graph/validate';

import { useBoard } from '../../store/board';
import { ImageMosaic, NodeShell } from './parts';

type Option = string | { value: string; label: string; disabled?: boolean };

export function Select({ value, options, onChange, label, id }: { value: string; options: Option[]; onChange: (v: string) => void; label: string; id: string }) {
  const opts = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  const known = opts.some((o) => o.value === value);
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <select id={id} className="nt-select nodrag" value={value} onChange={(e) => onChange(e.target.value)}>
        {/* Keep an unknown saved value visible instead of silently showing another one. */}
        {!known ? <option value={value}>{value} (unavailable)</option> : null}
        {opts.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Model, aspect ratio and quality, limited to what the chosen model supports. */
export function ModelSettings({ node, idPrefix }: { node: GenNode; idPrefix: string }) {
  const updateData = useBoard((s) => s.updateData);
  const notify = useBoard((s) => s.notify);
  const d = node.data;
  const model = getModel(d.model);
  const issues = settingsIssues(d.model, d.aspectRatio, d.quality);
  const notice = shutdownNotice(d.model);
  const changeModel = (id: string) => {
    const next = getModel(id)!;
    const patch: Partial<GenNode['data']> = { model: id };
    const changed: string[] = [];
    if (!next.qualities.includes(d.quality)) {
      patch.quality = 'Default';
      changed.push(`quality to Default (${next.label} has no "${d.quality}")`);
    }
    if (!apiSize(id, d.aspectRatio)) {
      patch.aspectRatio = 'Default';
      changed.push(`aspect ratio to Default (${next.label} can't do ${d.aspectRatio})`);
    }
    updateData(node.id, patch);
    if (changed.length) notify(`Changed ${changed.join(' and ')}.`);
  };
  return (
    <>
      <Select id={`${idPrefix}-model`} label="Model" value={d.model} options={IMAGE_MODEL_LIST.map((m) => ({ value: m.id, label: m.shutdown ? `${m.id} (ends ${formatDate(m.shutdown.date)})` : m.id }))} onChange={changeModel} />
      {issues.length ? (
        <p className="node-warning" role="status">
          {issues[0]}
        </p>
      ) : notice ? (
        <p className="node-warning node-warning--soft" role="status">
          {notice}
        </p>
      ) : null}
      <div className="field-row">
        <Select
          id={`${idPrefix}-aspect`}
          label="Aspect ratio"
          value={d.aspectRatio}
          options={ASPECT_RATIOS.map((a) => ({ value: a, label: a, disabled: !apiSize(d.model, a) }))}
          onChange={(v) => updateData(node.id, { aspectRatio: v })}
        />
        <Select id={`${idPrefix}-quality`} label="Quality" value={d.quality} options={model?.qualities ?? ['Default']} onChange={(v) => updateData(node.id, { quality: v })} />
      </div>
    </>
  );
}

export function useGenerationState(node: GenNode) {
  const nodes = useBoard((s) => s.nodes);
  const edges = useBoard((s) => s.edges);
  const inputs = resolveInputs(node, nodes, edges);
  const stale = isStale(node, nodes, edges);
  const connectedPrompts = edges.filter((e) => e.target === node.id && e.targetHandle === 'prompt').length;
  const status = node.data.status === 'succeeded' && stale ? 'stale' : node.data.status;
  return { inputs, stale, status, connectedPrompts } as const;
}

export function ImageGenerationNode(props: NodeProps<GenNode>) {
  const { id, data, selected } = props;
  const run = useBoard((s) => s.run);
  const running = useBoard((s) => s.running);
  const node = { id, data, type: 'imageGeneration', position: { x: 0, y: 0 } } as GenNode;
  const { status } = useGenerationState(node);
  const [pw, ph] = aspectSize(data.aspectRatio);
  // Show only the picked image when there is one, otherwise everything the node has made.
  const picked = selectedOutput(node);
  const shown = picked ? [picked] : data.outputs;

  return (
    <NodeShell
      kind="imageGeneration"
      title={data.title}
      selected={selected}
      width={400}
      hideSubtitle
      action={
        <button
          className="run-btn nodrag"
          title="Run this node and anything it depends on"
          aria-label={`Run ${data.title}`}
          disabled={running}
          onClick={() => void run(id)}
        >
          <Play size={15} fill="currentColor" />
        </button>
      }
    >
      <div
        className={`gen-output ${status === 'stale' ? 'is-stale' : ''} ${shown.length ? 'has-images' : ''}`}
        style={shown.length ? undefined : { aspectRatio: `${pw} / ${ph}` }}
      >
        {shown.length ? (
          <ImageMosaic images={shown} alt={() => `Output of ${data.title}`} />
        ) : (
          <div className="gen-output__empty">
            <Sparkles size={20} />
            <span>{status === 'running' ? 'Generating…' : status === 'failed' ? 'Failed. See the properties panel' : 'Run to generate an image'}</span>
          </div>
        )}
        {status === 'running' ? <div className="gen-output__shimmer" /> : null}
      </div>
    </NodeShell>
  );
}
