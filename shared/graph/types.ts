import type { Edge, Node } from '@xyflow/react';

/** Data types that can flow along an edge. Coercion between them is never implicit. */
export type PortType = 'text' | 'image';

export type PortDef = {
  id: string;
  label: string;
  type: PortType;
  /** Accepts more than one incoming edge. Order is the order edges were created. */
  multi?: boolean;
};

export type NodeKind = 'prompt' | 'imageInput' | 'imageGeneration';

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

export type NodeData = PromptData | ImageInputData | ImageGenerationData;

export type PromptNode = Node<PromptData, 'prompt'>;
export type ImageInputNode = Node<ImageInputData, 'imageInput'>;
export type ImageGenerationNode = Node<ImageGenerationData, 'imageGeneration'>;
export type AppNode = PromptNode | ImageInputNode | ImageGenerationNode;
export type AppEdge = Edge;

export const RUN_FIELDS = [
  'status',
  'error',
  'outputs',
  'selectedOutputId',
  'lastRunKey',
  'lastRunAt',
] as const;
