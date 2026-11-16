import type { NodeProps } from '@xyflow/react';
import { Play, Sparkles } from 'lucide-react';
import { ASPECT_RATIOS, CATALOG, IMAGE_MODELS, QUALITIES } from '../../graph/catalog';
import type { ImageGenerationNode as GenNode } from '../../graph/types';
import { isStale, resolveInputs, selectedOutput } from '../../graph/validate';
import { aspectSize } from '../../lib/images';
import { useBoard } from '../../store/board';
import { NodeShell, Port, StatusChip } from './parts';

export function Select({ value, options, onChange, label, id }: { value: string; options: string[]; onChange: (v: string) => void; label: string; id: string }) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <select id={id} className="nt-select nodrag" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o}>{o}</option>
        ))}
      </select>
    </div>
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
  const updateData = useBoard((s) => s.updateData);
  const run = useBoard((s) => s.run);
  const running = useBoard((s) => s.running);
  const node = { id, data, type: 'imageGeneration', position: { x: 0, y: 0 } } as GenNode;
  const { inputs, status, connectedPrompts } = useGenerationState(node);
  const out = selectedOutput(node);
  const [pw, ph] = aspectSize(data.aspectRatio);
  const [promptPort, refPort] = CATALOG.imageGeneration.inputs;

  return (
    <NodeShell
      kind="imageGeneration"
      title={data.title}
      selected={selected}
      width={400}
      status={
        <div className="nt-node__status">
          <StatusChip status={status} />
        </div>
      }
      action={
        <>
          <button
            className="run-btn nodrag"
            title="Run this node and anything it depends on"
            aria-label={`Run ${data.title}`}
            disabled={running}
            onClick={() => void run(id)}
          >
            <Play size={15} fill="currentColor" />
          </button>
          <Port port={CATALOG.imageGeneration.outputs[0]} side="out" />
        </>
      }
    >
      <div className="port-row">
        <Port port={promptPort} side="in" />
        <span className="port-row__label">Prompt</span>
        <span className="port-row__meta">
          {connectedPrompts ? `${connectedPrompts} connected` : 'Text · optional if written below'}
        </span>
      </div>
      <div className="port-row">
        <Port port={refPort} side="in" />
        <span className="port-row__label">References</span>
        <span className="port-row__meta">{inputs.references.length ? `${inputs.references.length} image${inputs.references.length > 1 ? 's' : ''}` : 'Image · optional'}</span>
      </div>

      <label className="field-label" htmlFor={`gp-${id}`}>
        {connectedPrompts ? 'Additional prompt' : 'Prompt'}
      </label>
      <textarea
        id={`gp-${id}`}
        className="nt-textarea nodrag nowheel"
        rows={3}
        placeholder={connectedPrompts ? 'Added after the connected prompt…' : 'Describe the image you want…'}
        value={data.prompt}
        onChange={(e) => updateData(id, { prompt: e.target.value })}
      />
      <Select id={`gm-${id}`} label="Model" value={data.model} options={IMAGE_MODELS} onChange={(v) => updateData(id, { model: v })} />
      <div className="field-row">
        <Select id={`ga-${id}`} label="Aspect ratio" value={data.aspectRatio} options={ASPECT_RATIOS} onChange={(v) => updateData(id, { aspectRatio: v })} />
        <Select id={`gq-${id}`} label="Quality" value={data.quality} options={QUALITIES} onChange={(v) => updateData(id, { quality: v })} />
      </div>

      {data.status === 'failed' && data.error ? (
        <p className="node-error" role="alert">
          {data.error}
        </p>
      ) : null}

      <div className={`gen-output ${status === 'stale' ? 'is-stale' : ''}`} style={{ aspectRatio: `${pw} / ${ph}` }}>
        {out ? (
          <img src={out.src} alt={`Output of ${data.title}`} draggable={false} />
        ) : (
          <div className="gen-output__empty">
            <Sparkles size={20} />
            <span>{status === 'running' ? 'Generating…' : 'Run to generate an image'}</span>
          </div>
        )}
        {status === 'running' ? <div className="gen-output__shimmer" /> : null}
        {data.outputs.length > 1 ? <span className="gen-output__count">{data.outputs.length} versions</span> : null}
      </div>
    </NodeShell>
  );
}
