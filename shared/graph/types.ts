import type { Edge, Node } from '@xyflow/react';
import type { TransformOptions } from './transforms';

/** Data types that can flow along an edge. Coercion between them is never implicit. */
export type PortType = 'text' | 'image';

export type PortDef = {
  id: string;
  label: string;
  type: PortType;
  /** Accepts more than one incoming edge. Order is the order edges were created. */
  multi?: boolean;
};

export type NodeKind = 'prompt' | 'imageInput' | 'imageGeneration' | 'imageTransform';

export type RunStatus = 'idle' | 'queued' | 'running' | 'succeeded' | 'failed';

/**
 * Reference to an immutable image artifact stored by the local server.
 * `src` is the full-size URL; `thumb` a smaller preview when available.
 */
export type ImageAsset = {
  id: string;
  src: string;
  thumb?: string;
  name: string;
  width: number;
  height: number;
  mime?: string;
  createdAt: number;
  /** Set on generated images: which run produced it. */
  runId?: string;
  /** Which provider produced it, e.g. "simulated" or "openai". */
  provider?: string;
};

export type PromptData = {
  kind: 'prompt';
  title: string;
  text: string;
  /** Free-text model name. Not used by runs yet. */
  model?: string;
};

export type ImageInputData = {
  kind: 'imageInput';
  title: string;
  images: ImageAsset[];
};

export type ImageGenerationData = {
  kind: 'imageGeneration';
  title: string;
  /** Inline prompt. Appended after any connected Prompt nodes. */
  prompt: string;
  model: string;
  aspectRatio: string;
  quality: string;
  // Run state. Kept out of undo history.
  status: RunStatus;
  error?: string;
  /** Every output this node has produced, newest first. */
  outputs: ImageAsset[];
  selectedOutputId?: string;
  /** Fingerprint of inputs + settings used for the last successful run. */
  lastRunKey?: string;
  lastRunAt?: number;
};

/** Edits the images it receives (remove background, upscale, ...) on this computer, with no model involved. */
export type ImageTransformData = {
  kind: 'imageTransform';
  title: string;
  /** Id of an operation in shared/graph/transforms.ts. */
  operation: string;
  options: TransformOptions;
  // Run state. Kept out of undo history.
  status: RunStatus;
  error?: string;
  /** What the last successful run produced, one image per input. */
  outputs: ImageAsset[];
  selectedOutputId?: string;
  lastRunKey?: string;
  lastRunAt?: number;
};

export type NodeData = PromptData | ImageInputData | ImageGenerationData | ImageTransformData;

export type PromptNode = Node<PromptData, 'prompt'>;
export type ImageInputNode = Node<ImageInputData, 'imageInput'>;
export type ImageGenerationNode = Node<ImageGenerationData, 'imageGeneration'>;
export type ImageTransformNode = Node<ImageTransformData, 'imageTransform'>;
export type AppNode = PromptNode | ImageInputNode | ImageGenerationNode | ImageTransformNode;
/** Nodes that run and keep outputs. */
export type RunnableNode = ImageGenerationNode | ImageTransformNode;

export function isRunnable(n: { type?: string } | undefined | null): n is RunnableNode {
  return n?.type === 'imageGeneration' || n?.type === 'imageTransform';
}
export type AppEdge = Edge;

/** A named set of nodes drawn inside one frame. Visual only: it never changes how a workflow runs. */
export type NodeGroup = { id: string; title: string; nodeIds: string[] };

export const RUN_FIELDS = [
  'status',
  'error',
  'outputs',
  'selectedOutputId',
  'lastRunKey',
  'lastRunAt',
] as const;
