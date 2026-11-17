import type { NodeProps } from '@xyflow/react';
import type { PromptNode as PromptNodeType } from '../../../shared/graph/types';
import { useBoard } from '../../store/board';
import { NodeShell } from './parts';

export function PromptNode({ id, data, selected }: NodeProps<PromptNodeType>) {
  const updateData = useBoard((s) => s.updateData);
  return (
    <NodeShell
      kind="prompt"
      title={data.title}
      selected={selected}
      width={300}
    >
      <label className="field-label" htmlFor={`prompt-${id}`}>
        Text
      </label>
      <textarea
        id={`prompt-${id}`}
        className="nt-textarea nodrag nowheel"
        rows={4}
        placeholder="Describe the subject, style, lighting…"
        value={data.text}
        onChange={(e) => updateData(id, { text: e.target.value })}
      />
    </NodeShell>
  );
}
