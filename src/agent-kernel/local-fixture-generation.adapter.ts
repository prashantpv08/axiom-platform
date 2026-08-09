import { performance } from 'node:perf_hooks';

import type { GenerationProviderAdapter } from './generation-provider.adapter';
import { ProviderGenerationError } from './generation-provider.adapter';
import {
  GenerationRequestSchema,
  GenerationResultSchema,
  type GenerationRequest,
  type GenerationResult
} from './generation.schema';

export const LOCAL_FIXTURE_MODEL_DEFINITION_ID = 'MODEL-AXIOM-STRUCTURED-FIXTURE-V1';
export const LOCAL_FIXTURE_IMMUTABLE_MODEL_ID = 'axiom-structured-fixture-v1';

export class LocalFixtureGenerationAdapter implements GenerationProviderAdapter {
  readonly providerCode = 'LOCAL_FIXTURE' as const;

  constructor(private readonly fixtureOutput: unknown) {}

  async generate(requestInput: GenerationRequest, signal?: AbortSignal): Promise<GenerationResult> {
    const startedAt = performance.now();
    const request = GenerationRequestSchema.safeParse(requestInput);
    if (!request.success || request.data.modelDefinitionId !== LOCAL_FIXTURE_MODEL_DEFINITION_ID) {
      throw new ProviderGenerationError('INVALID_REQUEST', 'Local fixture generation request is invalid', false);
    }
    if (signal?.aborted === true) {
      throw new ProviderGenerationError('CANCELLED', 'Local fixture generation was cancelled', false);
    }

    await Promise.resolve();
    return GenerationResultSchema.parse({
      provider: this.providerCode,
      providerRequestId: null,
      immutableModelId: LOCAL_FIXTURE_IMMUTABLE_MODEL_ID,
      finishReason: 'COMPLETE',
      structuredOutput: this.fixtureOutput,
      toolCalls: [],
      usage: { evidenceStatus: 'NOT_APPLICABLE', reason: 'NON_BILLABLE_LOCAL_FIXTURE' },
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      completedAt: new Date().toISOString()
    });
  }
}
