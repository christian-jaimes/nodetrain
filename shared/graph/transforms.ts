/**
 * Operations the Image Transformation node can apply. They all run on this computer (server/transforms.ts), so they
 * need no API key and cost nothing. The definitions live here so the app can draw the controls and the server can
 * check the values it is given.
 */

export type TransformParam =
  | { id: string; label: string; type: 'number'; min: number; max: number; step?: number; default: number; hint?: string; unit?: string }
  | { id: string; label: string; type: 'select'; options: string[]; default: string; hint?: string };

export type TransformOption = number | string;
export type TransformOptions = Record<string, TransformOption>;

export type TransformDef = {
  id: string;
  label: string;
  description: string;
  params: TransformParam[];
};

export const ASPECT_CROPS = ['1:1', '4:3', '3:2', '16:9', '3:4', '2:3', '9:16'];

/** Largest output a transformation may produce, in pixels. Keeps a 4x upscale from exhausting memory. */
export const MAX_OUTPUT_PIXELS = 40_000_000;

export const TRANSFORMS: TransformDef[] = [
  {
    id: 'removeBackground',
    label: 'Remove background',
    description: 'Makes a plain, single-colour background transparent. Works best on studio shots; busy backgrounds are not detected.',
    params: [
      { id: 'tolerance', label: 'Tolerance', type: 'number', min: 1, max: 100, step: 1, default: 20, hint: 'Raise it if background is left behind, lower it if the subject starts to erode.' },
      { id: 'softness', label: 'Edge softness', type: 'number', min: 0, max: 5, step: 0.5, default: 1, unit: 'px', hint: 'Blends the cut-out edge. 0 is a hard edge.' },
    ],
  },
  {
    id: 'upscale',
    label: 'Upscale',
    description: 'Enlarges the image with high-quality resampling.',
    params: [
      { id: 'scale', label: 'Scale', type: 'select', options: ['2x', '3x', '4x'], default: '2x' },
      { id: 'detail', label: 'Detail', type: 'select', options: ['Smooth', 'Balanced', 'Crisp'], default: 'Balanced', hint: 'How much sharpening is applied after enlarging.' },
    ],
  },
  {
    id: 'resize',
    label: 'Resize',
    description: 'Scales the image to a size in pixels. Leave one side at 0 to keep the proportions.',
    params: [
      { id: 'width', label: 'Width', type: 'number', min: 0, max: 8192, step: 1, default: 1024, unit: 'px' },
      { id: 'height', label: 'Height', type: 'number', min: 0, max: 8192, step: 1, default: 0, unit: 'px' },
      { id: 'fit', label: 'Fit', type: 'select', options: ['Fit inside', 'Fill and crop', 'Stretch'], default: 'Fit inside' },
    ],
  },
  {
    id: 'crop',
    label: 'Crop to aspect ratio',
    description: 'Trims the edges, around the centre, to a chosen shape.',
    params: [{ id: 'ratio', label: 'Aspect ratio', type: 'select', options: ASPECT_CROPS, default: '1:1' }],
  },
  {
    id: 'trim',
    label: 'Trim borders',
    description: 'Cuts away empty margins of one colour (or transparency) around the subject.',
    params: [{ id: 'threshold', label: 'Threshold', type: 'number', min: 1, max: 50, step: 1, default: 10, hint: 'How different from the border colour a pixel may be and still count as border.' }],
  },
  {
    id: 'rotate',
    label: 'Rotate and flip',
    description: 'Turns or mirrors the image.',
    params: [
      { id: 'rotation', label: 'Rotate', type: 'select', options: ['None', '90° clockwise', '180°', '90° counterclockwise'], default: '90° clockwise' },
      { id: 'flip', label: 'Flip', type: 'select', options: ['None', 'Horizontal', 'Vertical'], default: 'None' },
    ],
  },
  {
    id: 'adjust',
    label: 'Brightness and colour',
    description: 'Adjusts brightness, contrast and colour saturation.',
    params: [
      { id: 'brightness', label: 'Brightness', type: 'number', min: -100, max: 100, step: 5, default: 0 },
      { id: 'contrast', label: 'Contrast', type: 'number', min: -100, max: 100, step: 5, default: 0 },
      { id: 'saturation', label: 'Saturation', type: 'number', min: -100, max: 100, step: 5, default: 0 },
    ],
  },
  {
    id: 'grayscale',
    label: 'Black and white',
    description: 'Removes all colour.',
    params: [],
  },
  {
    id: 'blur',
    label: 'Blur',
    description: 'Softens the image.',
    params: [{ id: 'radius', label: 'Radius', type: 'number', min: 0.5, max: 50, step: 0.5, default: 4, unit: 'px' }],
  },
  {
    id: 'sharpen',
    label: 'Sharpen',
    description: 'Makes edges and fine detail stand out.',
    params: [{ id: 'amount', label: 'Amount', type: 'number', min: 1, max: 10, step: 1, default: 3 }],
  },
];

export const DEFAULT_TRANSFORM = 'upscale';

export function getTransform(id: string): TransformDef | undefined {
  return TRANSFORMS.find((t) => t.id === id);
}

export function defaultOptions(id: string): TransformOptions {
  const def = getTransform(id);
  return Object.fromEntries((def?.params ?? []).map((p) => [p.id, p.default]));
}

/** The saved options for an operation with any missing or out-of-range value replaced by its default. */
export function normalizeOptions(id: string, options: TransformOptions | undefined): TransformOptions {
  const def = getTransform(id);
  const out: TransformOptions = {};
  for (const p of def?.params ?? []) {
    const v = options?.[p.id];
    if (p.type === 'number') out[p.id] = typeof v === 'number' && Number.isFinite(v) ? Math.min(p.max, Math.max(p.min, v)) : p.default;
    else out[p.id] = typeof v === 'string' && p.options.includes(v) ? v : p.default;
  }
  return out;
}

/** Problems that stop an operation running with these settings. */
export function transformIssues(id: string, options: TransformOptions | undefined): string[] {
  const def = getTransform(id);
  if (!def) return [`"${id}" is not an available operation.`];
  const o = normalizeOptions(id, options);
  if (id === 'resize' && !o.width && !o.height) return ['Set a width or a height to resize to.'];
  if (id === 'rotate' && o.rotation === 'None' && o.flip === 'None') return ['Choose a rotation or a flip.'];
  return [];
}

/** Short name of an operation with its main setting, for the run log. */
export function describeTransform(id: string, options: TransformOptions | undefined): string {
  const def = getTransform(id);
  if (!def) return id;
  const o = normalizeOptions(id, options);
  switch (id) {
    case 'upscale':
      return `Upscale ${o.scale}`;
    case 'resize':
      return `Resize to ${o.width || 'auto'} × ${o.height || 'auto'}`;
    case 'crop':
      return `Crop to ${o.ratio}`;
    default:
      return def.label;
  }
}
