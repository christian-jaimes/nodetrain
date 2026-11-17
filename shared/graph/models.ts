/**
 * Image models NodeTrain offers, and what each one supports. Checked against
 * OpenAI's API reference on 2026-11-16 (images/generations and images/edits).
 * Settings a model can't honour are reported as validation issues rather than
 * silently changed.
 */

/** USD per 1M tokens, standard tier, from OpenAI's pricing and model pages. */
export type TokenPrices = { textInput: number; imageInput: number; imageOutput: number };

export type ImageModel = {
  id: string;
  label: string;
  /** Accepts any WIDTHxHEIGHT (multiples of 16, ratio 1:3 to 3:1). Otherwise only the three standard sizes. */
  customSizes: boolean;
  qualities: string[];
  prices: TokenPrices;
  /** Set when OpenAI has announced a shutdown. */
  shutdown?: { date: string; replacement: string };
};

const STANDARD_QUALITIES = ['Default', 'Low', 'Medium', 'High'];
const EXTENDED_QUALITIES = [...STANDARD_QUALITIES, 'Extra high', 'Max'];
const P_STANDARD: TokenPrices = { textInput: 5, imageInput: 8, imageOutput: 30 };

/**
 * Checked against OpenAI's model, pricing and deprecation pages on 2026-11-16.
 * OpenAI doesn't yet document custom sizes or Extra high/Max for the 2.6
 * models, so they get the standard set until it does.
 */
export const IMAGE_MODEL_LIST: ImageModel[] = [
  { id: 'gpt-image-2.6-flare', label: 'GPT Image 2.6 Flare', customSizes: false, qualities: STANDARD_QUALITIES, prices: P_STANDARD },
  { id: 'gpt-image-2.6-sunburst', label: 'GPT Image 2.6 Sunburst', customSizes: false, qualities: STANDARD_QUALITIES, prices: P_STANDARD },
  { id: 'gpt-image-2.5-flare', label: 'GPT Image 2.5 Flare', customSizes: true, qualities: EXTENDED_QUALITIES, prices: P_STANDARD },
  { id: 'gpt-image-2.5-sunburst', label: 'GPT Image 2.5 Sunburst', customSizes: true, qualities: EXTENDED_QUALITIES, prices: P_STANDARD },
];

/** Flare is OpenAI's fast everyday model; Sunburst is for precise edits. */
export const DEFAULT_IMAGE_MODEL = 'gpt-image-2.5-sunburst';

/** Models that no longer work, and what boards using them are moved to. */
export const RETIRED_MODELS: Record<string, string> = {
  'gpt-image-1': DEFAULT_IMAGE_MODEL, // shut down 2026-10-23
  'dall-e-2': DEFAULT_IMAGE_MODEL,
  'dall-e-3': DEFAULT_IMAGE_MODEL,
  // Removed from the model list on 2026-11-17; boards using them move to the default.
  'gpt-image-2': DEFAULT_IMAGE_MODEL,
  'gpt-image-1.5': DEFAULT_IMAGE_MODEL,
  'gpt-image-1-mini': DEFAULT_IMAGE_MODEL,
};

/** Prices of models no longer offered, so old runs in the history keep their original estimate. */
const LEGACY_PRICES: Record<string, TokenPrices> = {
  'gpt-image-2': P_STANDARD,
  'gpt-image-1.5': { textInput: 5, imageInput: 8, imageOutput: 32 },
  'gpt-image-1-mini': { textInput: 2, imageInput: 2.5, imageOutput: 8 },
};

function pricesFor(modelId: string): TokenPrices | undefined {
  return getModel(modelId)?.prices ?? LEGACY_PRICES[modelId] ?? getModel(RETIRED_MODELS[modelId] ?? '')?.prices;
}

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
  if (!apiSize(modelId, aspect)) issues.push(`${m.label} can't make ${aspect} images. Use 1:1, 3:2 or 2:3, or a GPT Image 2.5 model.`);
  if (!m.qualities.includes(quality)) issues.push(`${m.label} doesn't offer "${quality}" quality.`);
  return issues;
}

/** "Dec 1, 2026", for shutdown notices. */
export function formatDate(iso: string) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** A notice for a model OpenAI is shutting down, or undefined. */
export function shutdownNotice(modelId: string): string | undefined {
  const m = getModel(modelId);
  if (!m?.shutdown) return undefined;
  return `OpenAI shuts down ${m.id} on ${formatDate(m.shutdown.date)}. Switch to ${m.shutdown.replacement}.`;
}

/**
 * Estimated cost in USD from the token usage OpenAI reports. Cache discounts
 * are ignored, so it errs slightly high. Undefined when there's nothing to price.
 */
export function estimateCost(modelId: string, usage: Record<string, number> | undefined): number | undefined {
  const prices = pricesFor(modelId);
  if (!prices || !usage) return undefined;
  const out = usage.outputTokens ?? 0;
  const image = usage.inputImageTokens ?? 0;
  const text = usage.inputTextTokens ?? Math.max(0, (usage.inputTokens ?? 0) - image);
  if (!out && !text && !image) return undefined;
  return (text * prices.textInput + image * prices.imageInput + out * prices.imageOutput) / 1_000_000;
}

/** The same estimate split by what it paid for: text input, versus image input and output. */
export function costBreakdown(modelId: string, usage: Record<string, number> | undefined): { textUsd: number; imageUsd: number } | undefined {
  const prices = pricesFor(modelId);
  if (!prices || !usage) return undefined;
  const out = usage.outputTokens ?? 0;
  const image = usage.inputImageTokens ?? 0;
  const text = usage.inputTextTokens ?? Math.max(0, (usage.inputTokens ?? 0) - image);
  if (!out && !text && !image) return undefined;
  return { textUsd: (text * prices.textInput) / 1_000_000, imageUsd: (image * prices.imageInput + out * prices.imageOutput) / 1_000_000 };
}

export function formatUsd(usd: number) {
  if (usd === 0) return '$0.00';
  if (usd < 0.01) return '<$0.01';
  return `$${usd.toFixed(2)}`;
}
