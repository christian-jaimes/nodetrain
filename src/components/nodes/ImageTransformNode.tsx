import type { NodeProps } from '@xyflow/react';
import { Wand2 } from 'lucide-react';
import { getTransform } from '../../../shared/graph/transforms';
import type { ImageTransformNode as TransformNode } from '../../../shared/graph/types';
import { isStale } from '../../../shared/graph/validate';
import { useBoard } from '../../store/board';
import { ImageMosaic, NodeShell, OutputGallery } from './parts';
import { Play } from 'lucide-react';

export function useTransformStatus(node: TransformNode) {
  const nodes = useBoard((s) => s.nodes);
  const edges = useBoard((s) => s.edges);
  const stale = isStale(node, nodes, edges);
  return node.data.status === 'succeeded' && stale ? ('stale' as const) : node.data.status;
}

export function ImageTransformNode(props: NodeProps<TransformNode>) {
  const { id, data, selected } = props;
  const run = useBoard((s) => s.run);
  const running = useBoard((s) => s.running);
  const selectOutput = useBoard((s) => s.selectOutput);
  const node = { id, data, type: 'imageTransform', position: { x: 0, y: 0 } } as TransformNode;
  const status = useTransformStatus(node);
  const shown = data.outputs;
  const picked = data.selectedOutputId ? shown.find((o) => o.id === data.selectedOutputId) : undefined;
  const label = getTransform(data.operation)?.label ?? data.operation;

  return (
    <NodeShell
      kind="imageTransform"
      title={data.title}
      selected={selected}
      width={400}
      hideSubtitle
      action={
        <button className="run-btn nodrag" title="Run this node and anything it depends on" aria-label={`Run ${data.title}`} disabled={running} onClick={() => void run(id)}>
          <Play size={15} fill="currentColor" />
        </button>
      }
    >
      <div className={`gen-output ${status === 'stale' ? 'is-stale' : ''} ${shown.length ? 'has-images' : ''}`} style={shown.length ? undefined : { aspectRatio: '3 / 2' }}>
        {shown.length ? (
          picked ? (
            <OutputGallery images={shown} selectedId={picked.id} onSelect={(oid) => selectOutput(id, oid)} alt={() => `Output of ${data.title}`} />
          ) : (
            <ImageMosaic images={shown} alt={() => `Output of ${data.title}`} onPick={shown.length > 1 ? (oid) => selectOutput(id, oid) : undefined} />
          )
        ) : (
          <div className="gen-output__empty">
            <Wand2 size={20} />
            <span>{status === 'running' ? 'Editing…' : status === 'failed' ? 'Failed. See the properties panel' : `Run to apply: ${label}`}</span>
          </div>
        )}
        {status === 'running' ? <div className="gen-output__shimmer" /> : null}
      </div>
    </NodeShell>
  );
}
