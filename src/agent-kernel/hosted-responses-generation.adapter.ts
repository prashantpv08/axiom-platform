import { performance } from 'node:perf_hooks';

import { z } from 'zod';

import type { GenerationProviderAdapter } from './generation-provider.adapter';
import { ProviderGenerationError } from './generation-provider.adapter';
import {
  GenerationRequestSchema,
  GenerationResultSchema,
  type GenerationRequest,
  type GenerationResult,
  type ModelProviderCode
} from './generation.schema';

type ReasoningEffort = 'none' | 'low' | 'medium' | 'high';
type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type HostedResponsesAdapterConfig = {
  apiKey: string;
  modelDefinitionId: string;
  modelId: string;
  reasoningEffort: ReasoningEffort;
  fetchImplementation?: FetchImplementation;
};

const ProviderUsageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  input_tokens_details: z.object({
    cached_tokens: z.number().int().nonnegative().optional()
  }).passthrough().optional(),
  output_tokens: z.number().int().nonnegative(),
  total_tokens: z.number().int().nonnegative()
}).passthrough();

const ProviderContentSchema = z.object({
  type: z.string(),
  text: z.string().optional(),
  refusal: z.string().optional()
}).passthrough();

const ProviderOutputSchema = z.object({
  type: z.string(),
  content: z.array(ProviderContentSchema).optional()
}).passthrough();

const ProviderResponseSchema = z.object({
  id: z.string().min(1).max(300),
  status: z.string().min(1).max(100),
  model: z.string().min(1).max(300),
  output: z.array(ProviderOutputSchema),
  usage: ProviderUsageSchema.nullable()
}).passthrough();

function safeProviderRequestId(response: Response): string | null {
  const requestId = response.headers.get('x-request-id');
  return requestId === null || requestId.length === 0 ? null : requestId.slice(0, 300);
}

function classifyHttpFailure(status: number): { code: ConstructorParameters<typeof ProviderGenerationError>[0]; retryable: boolean } {
  if (status === 401 || status === 403) return { code: 'AUTHENTICATION_FAILED', retryable: false };
  if (status === 408) return { code: 'TIMEOUT', retryable: true };
  if (status === 429) return { code: 'RATE_LIMITED', retryable: true };
  if (status >= 500) return { code: 'PROVIDER_UNAVAILABLE', retryable: true };
  return { code: 'INVALID_REQUEST', retryable: false };
}

function abortError(signal: AbortSignal | undefined): ProviderGenerationError {
  const reason = signal?.reason;
  if (reason instanceof DOMException && reason.name === 'TimeoutError') {
    return new ProviderGenerationError('TIMEOUT', 'The generation provider timed out', true);
  }
  return new ProviderGenerationError('CANCELLED', 'The generation request was cancelled', false);
}

function isSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function extractStructuredOutput(output: z.infer<typeof ProviderOutputSchema>[]): unknown {
  const textParts: string[] = [];
  for (const item of output) {
    if (item.type !== 'message') continue;
    for (const content of item.content ?? []) {
      if (content.type === 'refusal' || content.refusal !== undefined) {
        throw new ProviderGenerationError('CONTENT_BLOCKED', 'The generation provider refused the request', false);
      }
      if (content.type === 'output_text' && content.text !== undefined) textParts.push(content.text);
    }
  }
  const combined = textParts.join('');
  if (combined.length === 0) {
    throw new ProviderGenerationError('INVALID_RESPONSE', 'The generation provider returned no structured output', false);
  }
  try {
    return JSON.parse(combined) as unknown;
  } catch {
    throw new ProviderGenerationError('INVALID_RESPONSE', 'The generation provider returned invalid JSON', false);
  }
}

abstract class HostedResponsesGenerationAdapter implements GenerationProviderAdapter {
  abstract readonly providerCode: ModelProviderCode;
  protected abstract readonly endpoint: string;
  protected abstract readonly includeSafetyIdentifier: boolean;

  private readonly apiKey: string;
  private readonly modelDefinitionId: string;
  private readonly modelId: string;
  private readonly reasoningEffort: ReasoningEffort;
  private readonly fetchImplementation: FetchImplementation;

  constructor(config: HostedResponsesAdapterConfig) {
    if (config.apiKey.trim().length === 0) throw new Error('Hosted provider API key is required');
    if (!/^MODEL-[A-Za-z0-9_-]{1,122}$/u.test(config.modelDefinitionId)) throw new Error('Hosted model definition ID is invalid');
    if (config.modelId.trim().length === 0 || config.modelId.length > 300) throw new Error('Hosted model ID is invalid');
    this.apiKey = config.apiKey;
    this.modelDefinitionId = config.modelDefinitionId;
    this.modelId = config.modelId;
    this.reasoningEffort = config.reasoningEffort;
    this.fetchImplementation = config.fetchImplementation ?? fetch;
  }

  async generate(requestInput: GenerationRequest, signal?: AbortSignal): Promise<GenerationResult> {
    const startedAt = performance.now();
    const parsedRequest = GenerationRequestSchema.safeParse(requestInput);
    if (!parsedRequest.success || parsedRequest.data.modelDefinitionId !== this.modelDefinitionId || parsedRequest.data.tools.length > 0) {
      throw new ProviderGenerationError('INVALID_REQUEST', 'Hosted generation request is invalid or requests unsupported tools', false);
    }
    if (isSignalAborted(signal)) throw abortError(signal);
    const request = parsedRequest.data;
    if (this.includeSafetyIdentifier && request.safetyIdentifier === null) {
      throw new ProviderGenerationError('INVALID_REQUEST', 'OpenAI generation requires a privacy-preserving safety identifier', false);
    }
    const body: Record<string, unknown> = {
      model: this.modelId,
      input: request.messages.map((message) => ({
        role: message.role === 'SYSTEM' ? 'developer' : message.role.toLowerCase(),
        content: message.content
      })),
      max_output_tokens: request.maxOutputTokens,
      reasoning: { effort: this.reasoningEffort },
      store: false,
      text: {
        format: {
          type: 'json_schema',
          name: request.structuredOutput.name,
          strict: false,
          schema: request.structuredOutput.jsonSchema
        }
      }
    };
    if (this.includeSafetyIdentifier) body.safety_identifier = request.safetyIdentifier;

    let response: Response;
    try {
      const requestInit: RequestInit = {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify(body)
      };
      if (signal !== undefined) requestInit.signal = signal;
      response = await this.fetchImplementation(this.endpoint, requestInit);
    } catch {
      if (isSignalAborted(signal)) throw abortError(signal);
      throw new ProviderGenerationError('PROVIDER_UNAVAILABLE', 'The generation provider could not be reached', true);
    }

    const headerRequestId = safeProviderRequestId(response);
    if (!response.ok) {
      const failure = classifyHttpFailure(response.status);
      throw new ProviderGenerationError(failure.code, `The generation provider rejected the request with HTTP ${response.status}`, failure.retryable, headerRequestId);
    }

    let rawBody: unknown;
    try {
      const text = await response.text();
      if (text.length > 10_000_000) throw new Error('Provider response exceeded the bounded response size');
      rawBody = JSON.parse(text) as unknown;
    } catch {
      throw new ProviderGenerationError('INVALID_RESPONSE', 'The generation provider returned an unreadable response', false, headerRequestId);
    }
    const parsedResponse = ProviderResponseSchema.safeParse(rawBody);
    if (!parsedResponse.success || parsedResponse.data.status !== 'completed' || parsedResponse.data.usage === null) {
      throw new ProviderGenerationError('INVALID_RESPONSE', 'The generation provider returned an incomplete response', false, headerRequestId);
    }
    const structuredOutput = extractStructuredOutput(parsedResponse.data.output);
    const usage = parsedResponse.data.usage;
    return GenerationResultSchema.parse({
      provider: this.providerCode,
      providerRequestId: parsedResponse.data.id,
      immutableModelId: parsedResponse.data.model,
      finishReason: 'COMPLETE',
      structuredOutput,
      toolCalls: [],
      usage: {
        evidenceStatus: 'MEASURED',
        measurementSource: 'PROVIDER_RESPONSE',
        inputTokens: usage.input_tokens,
        cachedInputTokens: usage.input_tokens_details?.cached_tokens ?? 0,
        outputTokens: usage.output_tokens,
        totalTokens: usage.total_tokens
      },
      latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
      completedAt: new Date().toISOString()
    });
  }
}

export class OpenAIResponsesGenerationAdapter extends HostedResponsesGenerationAdapter {
  readonly providerCode = 'OPENAI' as const;
  protected readonly endpoint = 'https://api.openai.com/v1/responses';
  protected readonly includeSafetyIdentifier = true;
}

export class GroqResponsesGenerationAdapter extends HostedResponsesGenerationAdapter {
  readonly providerCode = 'GROQ' as const;
  protected readonly endpoint = 'https://api.groq.com/openai/v1/responses';
  protected readonly includeSafetyIdentifier = false;
}
