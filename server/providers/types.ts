/**
 * Boundary between workflow nodes and model providers. Nodes describe intent;
 * adapters map it to a provider's API and report what they support. Step 3
 * adds an OpenAI adapter behind this same interface.
 */

export type ErrorCategory = 'auth' | 'quota' | 'invalid_input' | 'unsupported' | 'transient' | 'safety' | 'outage' | 'canceled' | 'internal';

export class ProviderError extends Error {
  category: ErrorCategory;
  retryable: boolean;
  constructor(message: string, category: ErrorCategory, retryable = false) {
    super(message);
    this.category = category;
    this.retryable = retryable;
  }
}

export type ReferenceImage = { id: string; path: string; mime: string; width: number; height: number };

export type ImageGenerationRequest = {
  prompt: string;
  references: ReferenceImage[];
  model: string;
  aspectRatio: string;
  quality: string;
  signal: AbortSignal;
};

export type GeneratedImage = { data: Buffer; mime: string };

export type ImageGenerationResult = {
  images: GeneratedImage[];
  /** Usage or cost data when the provider reports it. */
  usage?: Record<string, number>;
};

export type ProviderCapabilities = {
  models: string[];
  maxReferences: number;
  aspectRatios: string[];
  qualities: string[];
};

export interface ImageProvider {
  id: string;
  label: string;
  capabilities(): ProviderCapabilities;
  generateImage(req: ImageGenerationRequest): Promise<ImageGenerationResult>;
}
