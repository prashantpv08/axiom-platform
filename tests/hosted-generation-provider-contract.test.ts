import { describe, expect, it } from 'vitest';

import {
  GROQ_GPT_OSS_20B_MODEL_DEFINITION_ID,
  GROQ_GPT_OSS_20B_MODEL_ID,
  OPENAI_GPT_5_6_TERRA_MODEL_DEFINITION_ID,
  OPENAI_GPT_5_6_TERRA_MODEL_ID
} from '../src/agent-kernel/candidate-models';
import type { ProviderGenerationError } from '../src/agent-kernel/generation-provider.adapter';
import {
  GroqResponsesGenerationAdapter,
  OpenAIResponsesGenerationAdapter,
  type HostedResponsesAdapterConfig
} from '../src/agent-kernel/hosted-responses-generation.adapter';
import type { GenerationRequest } from '../src/agent-kernel/generation.schema';

const safetyIdentifier = 'b'.repeat(64);

function request(modelDefinitionId: string): GenerationRequest {
  return {
    organizationId: 'ORG-HOSTED-CONTRACT',
    projectId: 'PROJ-HOSTED-CONTRACT',
    runId: 'ARUN-hosted-contract',
    generationId: 'GEN-hosted-contract',
    workflow: 'ticket-generation',
    workflowVersion: 'ticket-workflow-v1',
    modelDefinitionId,
    safetyIdentifier,
    messages: [
      { role: 'SYSTEM', content: 'Return only the bounded structured result.' },
      { role: 'USER', content: 'Create the grounded work item.' }
    ],
    structuredOutput: {
      name: 'hosted_contract',
      version: 'v1',
      jsonSchema: {
        type: 'object',
        properties: { title: { type: 'string' } },
        required: ['title'],
        additionalProperties: false
      }
    },
    tools: [],
    maxOutputTokens: 1_000,
    timeoutMs: 5_000
  };
}

function completedResponse(model: string): Response {
  return new Response(JSON.stringify({
    id: 'resp_contract_123',
    status: 'completed',
    model,
    output: [{
      type: 'message',
      content: [{ type: 'output_text', text: JSON.stringify({ title: 'Grounded provider output' }) }]
    }],
    usage: {
      input_tokens: 101,
      input_tokens_details: { cached_tokens: 11 },
      output_tokens: 29,
      total_tokens: 130
    }
  }), { status: 200, headers: { 'content-type': 'application/json', 'x-request-id': 'request-header-123' } });
}

function config(
  modelDefinitionId: string,
  modelId: string,
  fetchImplementation: NonNullable<HostedResponsesAdapterConfig['fetchImplementation']>
): HostedResponsesAdapterConfig {
  return { apiKey: 'test-key-never-sent-to-a-provider', modelDefinitionId, modelId, reasoningEffort: 'low', fetchImplementation };
}

describe('hosted Responses API generation adapters', () => {
  it('maps the OpenAI contract without retaining a response and preserves measured usage', async () => {
    let endpoint = '';
    let authorization = '';
    let body: Record<string, unknown> = {};
    const adapter = new OpenAIResponsesGenerationAdapter(config(
      OPENAI_GPT_5_6_TERRA_MODEL_DEFINITION_ID,
      OPENAI_GPT_5_6_TERRA_MODEL_ID,
      async (input, init) => {
        endpoint = String(input);
        authorization = new Headers(init?.headers).get('authorization') ?? '';
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return completedResponse(OPENAI_GPT_5_6_TERRA_MODEL_ID);
      }
    ));

    const result = await adapter.generate(request(OPENAI_GPT_5_6_TERRA_MODEL_DEFINITION_ID));

    expect(endpoint).toBe('https://api.openai.com/v1/responses');
    expect(authorization).toBe('Bearer test-key-never-sent-to-a-provider');
    expect(body).toMatchObject({
      model: OPENAI_GPT_5_6_TERRA_MODEL_ID,
      store: false,
      max_output_tokens: 1_000,
      reasoning: { effort: 'low' },
      safety_identifier: safetyIdentifier,
      text: { format: { type: 'json_schema', name: 'hosted_contract', strict: false } }
    });
    expect(body.input).toEqual([
      { role: 'developer', content: 'Return only the bounded structured result.' },
      { role: 'user', content: 'Create the grounded work item.' }
    ]);
    expect(result).toMatchObject({
      provider: 'OPENAI',
      providerRequestId: 'resp_contract_123',
      immutableModelId: OPENAI_GPT_5_6_TERRA_MODEL_ID,
      structuredOutput: { title: 'Grounded provider output' },
      usage: {
        evidenceStatus: 'MEASURED',
        measurementSource: 'PROVIDER_RESPONSE',
        inputTokens: 101,
        cachedInputTokens: 11,
        outputTokens: 29,
        totalTokens: 130
      }
    });
  });

  it('uses the Groq-compatible Responses endpoint without forwarding the OpenAI safety field', async () => {
    let endpoint = '';
    let body: Record<string, unknown> = {};
    const adapter = new GroqResponsesGenerationAdapter(config(
      GROQ_GPT_OSS_20B_MODEL_DEFINITION_ID,
      GROQ_GPT_OSS_20B_MODEL_ID,
      async (input, init) => {
        endpoint = String(input);
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return completedResponse(GROQ_GPT_OSS_20B_MODEL_ID);
      }
    ));

    const result = await adapter.generate(request(GROQ_GPT_OSS_20B_MODEL_DEFINITION_ID));

    expect(endpoint).toBe('https://api.groq.com/openai/v1/responses');
    expect(body).not.toHaveProperty('safety_identifier');
    expect(result).toMatchObject({ provider: 'GROQ', immutableModelId: GROQ_GPT_OSS_20B_MODEL_ID });
  });

  it('classifies rate limiting as bounded and retryable without exposing provider response content', async () => {
    const adapter = new OpenAIResponsesGenerationAdapter(config(
      OPENAI_GPT_5_6_TERRA_MODEL_DEFINITION_ID,
      OPENAI_GPT_5_6_TERRA_MODEL_ID,
      async () => new Response(JSON.stringify({ error: { message: 'secret provider detail' } }), {
        status: 429,
        headers: { 'x-request-id': 'rate-limit-request' }
      })
    ));

    const failure = await adapter.generate(request(OPENAI_GPT_5_6_TERRA_MODEL_DEFINITION_ID)).catch((cause: unknown) => cause);
    expect(failure).toMatchObject({ code: 'RATE_LIMITED', retryable: true, providerRequestId: 'rate-limit-request' } satisfies Partial<ProviderGenerationError>);
    expect(String(failure)).not.toContain('secret provider detail');
  });

  it('rejects syntactically invalid provider JSON before domain validation', async () => {
    const malformed = completedResponse(OPENAI_GPT_5_6_TERRA_MODEL_ID);
    const raw = await malformed.json() as { output: Array<{ content: Array<{ text: string }> }> };
    raw.output[0]!.content[0]!.text = '{not-json';
    const adapter = new OpenAIResponsesGenerationAdapter(config(
      OPENAI_GPT_5_6_TERRA_MODEL_DEFINITION_ID,
      OPENAI_GPT_5_6_TERRA_MODEL_ID,
      async () => new Response(JSON.stringify(raw), { status: 200 })
    ));

    await expect(adapter.generate(request(OPENAI_GPT_5_6_TERRA_MODEL_DEFINITION_ID)))
      .rejects.toMatchObject({ code: 'INVALID_RESPONSE', retryable: false } satisfies Partial<ProviderGenerationError>);
  });

  it('fails before network access for an altered model definition or unsupported tool request', async () => {
    let calls = 0;
    const adapter = new GroqResponsesGenerationAdapter(config(
      GROQ_GPT_OSS_20B_MODEL_DEFINITION_ID,
      GROQ_GPT_OSS_20B_MODEL_ID,
      async () => { calls += 1; return completedResponse(GROQ_GPT_OSS_20B_MODEL_ID); }
    ));
    const invalid = request(GROQ_GPT_OSS_20B_MODEL_DEFINITION_ID);
    invalid.tools = [{ name: 'external_write', description: 'An external side effect that is not allowed.', inputSchema: { type: 'object' } }];

    await expect(adapter.generate(invalid)).rejects.toMatchObject({ code: 'INVALID_REQUEST', retryable: false });
    expect(calls).toBe(0);
  });

  it('requires the privacy-preserving safety identifier before an OpenAI request', async () => {
    let calls = 0;
    const adapter = new OpenAIResponsesGenerationAdapter(config(
      OPENAI_GPT_5_6_TERRA_MODEL_DEFINITION_ID,
      OPENAI_GPT_5_6_TERRA_MODEL_ID,
      async () => { calls += 1; return completedResponse(OPENAI_GPT_5_6_TERRA_MODEL_ID); }
    ));
    const invalid = request(OPENAI_GPT_5_6_TERRA_MODEL_DEFINITION_ID);
    invalid.safetyIdentifier = null;

    await expect(adapter.generate(invalid)).rejects.toMatchObject({ code: 'INVALID_REQUEST', retryable: false });
    expect(calls).toBe(0);
  });
});
