import type { NodeProps } from '@xyflow/react';
import type { PromptNode as PromptNodeType } from '../../../shared/graph/types';
import { useBoard } from '../../store/board';
import { NodeShell } from './parts';

export function PromptNode({ id, data, selected }: NodeProps<PromptNodeType>) {
  const updateData = useBoard((s) => s.updateData);
  return (
    <NodeShell
      id={id}
      kind="prompt"
      title={data.title}
      selected={selected}
    >
      <label className="field-label" htmlFor={`prompt-${id}`}>
        Text
      </label>
      <textarea
        id={`prompt-${id}`}
        className="nt-textarea nodrag nowheel"
        rows={4}
        placeholder="Describe the subject, style, lighting… Use <node title> for the generation node's name"
        value={data.text}
        onChange={(e) => updateData(id, { text: e.target.value })}
      />
    </NodeShell>
  );
}
