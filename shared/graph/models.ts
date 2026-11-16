/**
 * Image models NodeTrain offers, and what each one supports. Checked against
 * OpenAI's API reference on 2026-11-16 (images/generations and images/edits).
 * Settings a model can't honour are reported as validation issues rather than
 * silently changed.
 */

export type ImageModel = {
  id: string;
  label: string;
  /** Accepts any WIDTHxHEIGHT (multiples of 16, ratio 1:3 to 3:1). Otherwise only the three standard sizes. */
  customSizes: boolean;
  qualities: string[];
  note?: string;
};

export const IMAGE_MODEL_LIST: ImageModel[] = [
  { id: 'gpt-image-2', label: 'GPT Image 2', customSizes: true, qualities: ['Default', 'Low', 'Medium', 'High'] },
  {
    id: 'gpt-image-2.5-sunburst',
    label: 'GPT Image 2.5 Sunburst',
    customSizes: true,
    qualities: ['Default', 'Low', 'Medium', 'High', 'Extra high', 'Max'],
  },
  {
    id: 'gpt-image-2.5-flare',
    label: 'GPT Image 2.5 Flare',
    customSizes: true,
    qualities: ['Default', 'Low', 'Medium', 'High', 'Extra high', 'Max'],
  },
  { id: 'gpt-image-1.5', label: 'GPT Image 1.5', customSizes: false, qualities: ['Default', 'Low', 'Medium', 'High'] },
  { id: 'gpt-image-1-mini', label: 'GPT Image 1 Mini', customSizes: false, qualities: ['Default', 'Low', 'Medium', 'High'] },
];

export const DEFAULT_IMAGE_MODEL = 'gpt-image-2';

/** Models that no longer work, and what boards using them are moved to. */
export const RETIRED_MODELS: Record<string, string> = {
  'gpt-image-1': 'gpt-image-2', // shut down 2026-10-23
  'dall-e-2': 'gpt-image-2',
  'dall-e-3': 'gpt-image-2',
};

export const ASPECT_RATIOS = ['Default', '1:1', '3:2', '2:3', '16:9'];
export const ALL_QUALITIES = ['Default', 'Low', 'Medium', 'High', 'Extra high', 'Max'];

export function getModel(id: string): ImageModel | undefined {
  return IMAGE_MODEL_LIST.find((m) => m.id === id);
}

/** Sizes the standard-size models accept, by aspect ratio. */
const STANDARD_SIZES: Record<string, string> = {
  Default: 'auto',
  '1:1': '1024x1024',
  '3:2': '1536x1024',
  '2:3': '1024x1536',
};

/** Custom sizes, all multiples of 16. */
const CUSTOM_SIZES: Record<string, string> = {
  Default: 'auto',
  '1:1': '1024x1024',
  '3:2': '1536x1024',
  '2:3': '1024x1536',
  '16:9': '1536x864',
};

/** The `size` value to send, or undefined if the model can't do that aspect ratio. */
export function apiSize(modelId: string, aspect: string): string | undefined {
  const m = getModel(modelId);
  if (!m) return undefined;
  return (m.customSizes ? CUSTOM_SIZES : STANDARD_SIZES)[aspect];
}

export function apiQuality(quality: string): string {
  return { Default: 'auto', Low: 'low', Medium: 'medium', High: 'high', 'Extra high': 'xhigh', Max: 'max' }[quality] ?? 'auto';
}

/** Problems with a model/aspect/quality combination, in plain words. */
export function settingsIssues(modelId: string, aspect: string, quality: string): string[] {
  const m = getModel(modelId);
  if (!m) {
    const replacement = RETIRED_MODELS[modelId];
    return [replacement ? `${modelId} has been retired. Switch to ${replacement}.` : `Unknown model "${modelId}". Pick one from the list.`];
  }
  const issues: string[] = [];
  if (!apiSize(modelId, aspect)) issues.push(`${m.label} can't make ${aspect} images. Use 1:1, 3:2 or 2:3, or a GPT Image 2 model.`);
  if (!m.qualities.includes(quality)) issues.push(`${m.label} doesn't offer "${quality}" quality.`);
  return issues;
}
