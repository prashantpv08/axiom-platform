import { describe, expect, it } from 'vitest';

import { ProviderGenerationError, type GenerationProviderAdapter } from '../src/agent-kernel/generation-provider.adapter';
import { executeProviderWithBoundedRetries } from '../src/agent-kernel/agent-kernel.service';
import {
  LOCAL_FIXTURE_MODEL_DEFINITION_ID,
  LocalFixtureGenerationAdapter
} from '../src/agent-kernel/local-fixture-generation.adapter';
import { GenerationUsageSchema, type GenerationRequest } from '../src/agent-kernel/generation.schema';

const request: GenerationRequest = {
  organizationId: 'ORG-ALPHA',
  projectId: 'PROJ-ALPHA',
  runId: 'ARUN-contract-001',
  generationId: 'GEN-contract-001',
  workflow: 'ticket-generation',
  workflowVersion: 'v1',
  modelDefinitionId: LOCAL_FIXTURE_MODEL_DEFINITION_ID,
  safetyIdentifier: 'a'.repeat(64),
  messages: [{ role: 'USER', content: 'Generate the bounded fixture output.' }],
  structuredOutput: {
    name: 'fixture_ticket',
    version: 'v1',
    jsonSchema: { type: 'object', additionalProperties: false }
  },
  tools: [],
  maxOutputTokens: 1_000,
  timeoutMs: 5_000
};

describe('provider-neutral generation contract', () => {
  it('returns deterministic structured fixture output without fabricated usage or provider request evidence', async () => {
    const fixture = { title: 'Grounded local fixture' };
    const result = await new LocalFixtureGenerationAdapter(fixture).generate(request);

    expect(result).toMatchObject({
      provider: 'LOCAL_FIXTURE',
      providerRequestId: null,
      immutableModelId: 'axiom-structured-fixture-v1',
      structuredOutput: fixture,
      usage: { evidenceStatus: 'NOT_APPLICABLE', reason: 'NON_BILLABLE_LOCAL_FIXTURE' }
    });
  });

  it('rejects a model definition that is not the allowlisted local fixture', async () => {
    const adapter = new LocalFixtureGenerationAdapter({});
    await expect(adapter.generate({ ...request, modelDefinitionId: 'MODEL-UNQUALIFIED' }))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST', retryable: false } satisfies Partial<ProviderGenerationError>);
  });

  it('rejects altered or fabricated measured usage totals', () => {
    expect(GenerationUsageSchema.safeParse({
      evidenceStatus: 'MEASURED',
      measurementSource: 'PROVIDER_RESPONSE',
      inputTokens: 10,
      cachedInputTokens: 2,
      outputTokens: 5,
      totalTokens: 99
    }).success).toBe(false);
  });

  it('retries only a bounded retryable provider failure and records every attempt', async () => {
    const fixture = new LocalFixtureGenerationAdapter({ title: 'Recovered fixture' });
    let providerCalls = 0;
    const adapter: GenerationProviderAdapter = {
      providerCode: 'LOCAL_FIXTURE',
      async generate(input, signal) {
        providerCalls += 1;
        if (providerCalls === 1) throw new ProviderGenerationError('PROVIDER_UNAVAILABLE', 'Temporary fixture outage', true);
        return fixture.generate(input, signal);
      }
    };
    const attempts: string[] = [];
    const result = await executeProviderWithBoundedRetries(adapter, request, 2, async (event) => {
      attempts.push(`${event.attempt}:${event.status}`);
    });
    expect(result.attempt).toBe(2);
    expect(result.result.structuredOutput).toEqual({ title: 'Recovered fixture' });
    expect(attempts).toEqual(['1:FAILED', '2:SUCCEEDED']);
  });

  it('does not retry a non-retryable provider failure', async () => {
    const adapter: GenerationProviderAdapter = {
      providerCode: 'LOCAL_FIXTURE',
      async generate() { throw new ProviderGenerationError('INVALID_REQUEST', 'Invalid fixture request', false); }
    };
    const attempts: string[] = [];
    await expect(executeProviderWithBoundedRetries(adapter, request, 3, async (event) => {
      attempts.push(`${event.attempt}:${event.status}`);
    })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(attempts).toEqual(['1:FAILED']);
  });
});
