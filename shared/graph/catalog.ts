import type { NodeData, NodeKind, PortDef, PortType } from './types';

export type NodeDef = {
  kind: NodeKind;
  label: string;
  description: string;
  family: 'Inputs' | 'AI' | 'Tools';
  inputs: PortDef[];
  outputs: PortDef[];
  create: () => NodeData;
};

import { DEFAULT_IMAGE_MODEL } from './models';
import { DEFAULT_TRANSFORM, defaultOptions } from './transforms';
export { ASPECT_RATIOS, ALL_QUALITIES, IMAGE_MODEL_LIST } from './models';

export const CATALOG: Record<NodeKind, NodeDef> = {
  prompt: {
    kind: 'prompt',
    label: 'Prompt',
    description: 'Write text that feeds a generation step.',
    family: 'Inputs',
    inputs: [],
    outputs: [{ id: 'text', label: 'Text', type: 'text' }],
    create: () => ({ kind: 'prompt', title: 'Prompt', text: '' }),
  },
  imageInput: {
    kind: 'imageInput',
    label: 'Image Input',
    description: 'Upload one or more reference images.',
    family: 'Inputs',
    inputs: [],
    outputs: [{ id: 'image', label: 'Images', type: 'image' }],
    create: () => ({ kind: 'imageInput', title: 'Image Input', images: [] }),
  },
  imageGeneration: {
    kind: 'imageGeneration',
    label: 'Image Generation',
    description: 'Generate an image from a prompt and optional references.',
    family: 'AI',
    inputs: [
      { id: 'prompt', label: 'Prompt', type: 'text', multi: true },
      { id: 'references', label: 'References', type: 'image', multi: true },
    ],
    outputs: [{ id: 'image', label: 'Image', type: 'image' }],
    create: () => ({
      kind: 'imageGeneration',
      title: 'Image generation',
      prompt: '',
      model: DEFAULT_IMAGE_MODEL,
      aspectRatio: 'Default',
      quality: 'Default',
      status: 'idle',
      outputs: [],
    }),
  },
  imageTransform: {
    kind: 'imageTransform',
    label: 'Image Transformation',
    description: 'Edit images in the middle of a workflow: remove the background, upscale, crop and more.',
    family: 'Tools',
    inputs: [{ id: 'image', label: 'Images', type: 'image', multi: true }],
    outputs: [{ id: 'image', label: 'Images', type: 'image' }],
    create: () => ({
      kind: 'imageTransform',
      title: 'Image transformation',
      operation: DEFAULT_TRANSFORM,
      options: defaultOptions(DEFAULT_TRANSFORM),
      status: 'idle',
      outputs: [],
    }),
  },
};

export const NODE_KINDS = Object.keys(CATALOG) as NodeKind[];

export const PORT_TYPE_LABEL: Record<PortType, string> = {
  text: 'Text',
  image: 'Image',
};

export function getPort(kind: NodeKind, handleType: 'source' | 'target', handleId: string | null | undefined) {
  const def = CATALOG[kind];
  const ports = handleType === 'source' ? def.outputs : def.inputs;
  return ports.find((p) => p.id === handleId) ?? (ports.length === 1 && !handleId ? ports[0] : undefined);
}


/** Output size in pixels for an aspect ratio setting. */
export function aspectSize(aspect: string): [number, number] {
  switch (aspect) {
    case '3:2':
      return [1152, 768];
    case '2:3':
      return [768, 1152];
    case '16:9':
      return [1280, 720];
    case '1:1':
      return [1024, 1024];
    default:
      return [1152, 768];
  }
}
