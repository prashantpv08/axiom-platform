import type { ModelProviderCode, GenerationErrorCode, GenerationRequest, GenerationResult } from './generation.schema';

export const GENERATION_PROVIDER_ADAPTER = Symbol('GENERATION_PROVIDER_ADAPTER');

export class ProviderGenerationError extends Error {
  constructor(
    readonly code: GenerationErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly providerRequestId: string | null = null
  ) {
    super(message);
    this.name = 'ProviderGenerationError';
  }
}

export interface GenerationProviderAdapter {
  readonly providerCode: ModelProviderCode;
  generate(request: GenerationRequest, signal?: AbortSignal): Promise<GenerationResult>;
}
