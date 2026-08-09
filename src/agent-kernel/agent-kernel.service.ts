import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { Inject, Injectable } from '@nestjs/common';
import type { OrganizationAccessContext } from '../identity/identity.schema';
import { ModelCatalogService } from '../model-catalog/model-catalog.service';
import type { ModelCatalog, ModelDefinition, ModelProvider } from '../model-catalog/model-catalog.schema';
import { AgentRunIdSchema, GenerationProvenanceSchema, ModelTierSchema, type GenerationProvenance, type ModelTier } from './agent-kernel.schema';
import { AGENT_KERNEL_REPOSITORY, type AgentKernelRepository } from './agent-kernel.repository';
import { ProviderGenerationError, type GenerationProviderAdapter } from './generation-provider.adapter';
import { GenerationRequestSchema, GenerationResultSchema, type GenerationMessage, type GenerationResult, type StructuredOutputContract } from './generation.schema';
import { LOCAL_FIXTURE_MODEL_DEFINITION_ID, LocalFixtureGenerationAdapter } from './local-fixture-generation.adapter';

type ExecuteStructuredInput<T> = {
  context: OrganizationAccessContext;
  projectId: string | null;
  generationId: string;
  requestId: string;
  tier: ModelTier;
  workflow: string;
  workflowVersion: string;
  promptVersion: string;
  messages: GenerationMessage[];
  structuredOutput: StructuredOutputContract;
  maximumAttempts: number;
  maxOutputTokens: number;
  timeoutMs: number;
  localFixtureOutput: unknown;
  validateOutput: (output: unknown) => T;
};

export type AgentKernelExecution<T> = {
  output: T;
  result: GenerationResult;
  provenance: GenerationProvenance;
};

export class AgentKernelPolicyError extends Error {
  constructor(message: string) { super(message); this.name = 'AgentKernelPolicyError'; }
}

export class AgentKernelOutputRejectedError extends Error {
  constructor(message: string) { super(message); this.name = 'AgentKernelOutputRejectedError'; }
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

export function createSafetyIdentifier(organizationId: string, userId: string): string {
  return createHash('sha256').update(`${organizationId}:${userId}`, 'utf8').digest('hex');
}

function route(catalog: ModelCatalog, tier: ModelTier): { model: ModelDefinition; provider: ModelProvider } {
  const policyField = tier === 'ECONOMY' ? 'economyModelDefinitionId' : tier === 'BALANCED' ? 'balancedModelDefinitionId' : 'bestModelDefinitionId';
  const model = catalog.models.find((candidate) => candidate.id === catalog.policy[policyField]);
  if (model === undefined || model.executionStatus !== 'ENABLED' || !model.capabilities.structuredOutput) {
    throw new AgentKernelPolicyError(`${tier} does not resolve to an enabled structured-output model.`);
  }
  const provider = catalog.providers.find((candidate) => candidate.id === model.providerId);
  if (provider === undefined || provider.executionStatus !== 'ENABLED') {
    throw new AgentKernelPolicyError('The routed model provider is disabled.');
  }
  if (provider.code !== 'LOCAL_FIXTURE' || model.id !== LOCAL_FIXTURE_MODEL_DEFINITION_ID || model.pricing.status !== 'NOT_APPLICABLE') {
    throw new AgentKernelPolicyError('Hosted generation remains disabled until qualification, credentials, and a chargeable budget reservation are implemented.');
  }
  return { model, provider };
}

function providerError(cause: unknown): ProviderGenerationError {
  if (cause instanceof ProviderGenerationError) return cause;
  return new ProviderGenerationError('PROVIDER_UNAVAILABLE', 'The generation provider failed unexpectedly', false);
}

export type ProviderAttemptEvent =
  | { status: 'SUCCEEDED'; attempt: number; modelCallId: string; result: GenerationResult }
  | { status: 'FAILED'; attempt: number; modelCallId: string; error: ProviderGenerationError; latencyMs: number };

export async function executeProviderWithBoundedRetries(
  adapter: GenerationProviderAdapter,
  request: Parameters<GenerationProviderAdapter['generate']>[0],
  maximumAttempts: number,
  onAttempt: (event: ProviderAttemptEvent) => Promise<void>
): Promise<{ result: GenerationResult; attempt: number; modelCallId: string }> {
  if (!Number.isInteger(maximumAttempts) || maximumAttempts < 1 || maximumAttempts > 3) {
    throw new AgentKernelPolicyError('Workflow retry policy is invalid.');
  }
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const modelCallId = `MCALL-${randomUUID()}`;
    const startedAt = performance.now();
    let result: GenerationResult;
    try {
      result = GenerationResultSchema.parse(await adapter.generate(request, AbortSignal.timeout(request.timeoutMs)));
    } catch (cause) {
      const error = providerError(cause);
      await onAttempt({ status: 'FAILED', attempt, modelCallId, error, latencyMs: Math.max(0, Math.round(performance.now() - startedAt)) });
      if (!error.retryable || attempt === maximumAttempts) throw error;
      continue;
    }
    await onAttempt({ status: 'SUCCEEDED', attempt, modelCallId, result });
    return { result, attempt, modelCallId };
  }
  throw new ProviderGenerationError('PROVIDER_UNAVAILABLE', 'No generation result was produced', false);
}

@Injectable()
export class AgentKernelService {
  constructor(
    @Inject(AGENT_KERNEL_REPOSITORY) private readonly repository: AgentKernelRepository,
    @Inject(ModelCatalogService) private readonly modelCatalog: ModelCatalogService
  ) {}

  async executeStructured<T>(input: ExecuteStructuredInput<T>): Promise<AgentKernelExecution<T>> {
    const tier = ModelTierSchema.parse(input.tier);
    const catalog = await this.modelCatalog.getCatalog(input.context);
    const { model, provider } = route(catalog, tier);
    if (input.maximumAttempts < 1 || input.maximumAttempts > 3) throw new AgentKernelPolicyError('Workflow retry policy is invalid.');
    if (model.maxOutputTokens !== null && input.maxOutputTokens > model.maxOutputTokens) {
      throw new AgentKernelPolicyError('Workflow output limit exceeds the routed model limit.');
    }

    const runId = AgentRunIdSchema.parse(`ARUN-${randomUUID()}`);
    const request = GenerationRequestSchema.parse({
      organizationId: input.context.organizationId,
      projectId: input.projectId,
      runId,
      generationId: input.generationId,
      workflow: input.workflow,
      workflowVersion: input.workflowVersion,
      modelDefinitionId: model.id,
      safetyIdentifier: createSafetyIdentifier(input.context.organizationId, input.context.userId),
      messages: input.messages,
      structuredOutput: input.structuredOutput,
      tools: [],
      maxOutputTokens: input.maxOutputTokens,
      timeoutMs: input.timeoutMs
    });
    const requestHash = sha256(request);
    await this.repository.begin({
      id: runId,
      organizationId: input.context.organizationId,
      projectId: input.projectId,
      generationId: input.generationId,
      workflow: input.workflow,
      workflowVersion: input.workflowVersion,
      promptVersion: input.promptVersion,
      policyId: catalog.policy.id,
      policyVersion: catalog.policy.rowVersion,
      tier,
      modelDefinitionId: model.id,
      contextHash: sha256(input.messages),
      requestId: input.requestId,
      actorUserId: input.context.userId
    });

    const adapter: GenerationProviderAdapter = new LocalFixtureGenerationAdapter(input.localFixtureOutput);
    try {
      const attempted = await executeProviderWithBoundedRetries(adapter, request, input.maximumAttempts, async (event) => {
        if (event.status === 'SUCCEEDED') {
          const result = event.result;
          await this.repository.recordModelCall({
            id: event.modelCallId,
            organizationId: input.context.organizationId,
            runId,
            attempt: event.attempt,
            provider: provider.code,
            modelDefinitionId: model.id,
            immutableModelId: result.immutableModelId,
            status: 'SUCCEEDED',
            requestHash,
            responseHash: sha256(result.structuredOutput),
            providerRequestId: result.providerRequestId,
            finishReason: result.finishReason,
            usage: result.usage,
            latencyMs: result.latencyMs,
            errorCode: null,
            retryable: false,
            occurredAt: result.completedAt
          });
          return;
        }
        const error = event.error;
        await this.repository.recordModelCall({
          id: event.modelCallId,
          organizationId: input.context.organizationId,
          runId,
          attempt: event.attempt,
          provider: provider.code,
          modelDefinitionId: model.id,
          immutableModelId: model.immutableModelId,
          status: 'FAILED',
          requestHash,
          responseHash: null,
          providerRequestId: error.providerRequestId,
          finishReason: null,
          usage: null,
          latencyMs: event.latencyMs,
          errorCode: error.code,
          retryable: error.retryable,
          occurredAt: new Date().toISOString()
        });
      });
      const finalResult = attempted.result;
      const finalModelCallId = attempted.modelCallId;
      let output: T;
      try {
        output = input.validateOutput(finalResult.structuredOutput);
      } catch (cause) {
        throw new AgentKernelOutputRejectedError(cause instanceof Error ? cause.message : 'Structured output validation failed');
      }
      const completedAt = new Date().toISOString();
      await this.repository.complete({
        organizationId: input.context.organizationId,
        runId,
        outputHash: sha256(finalResult.structuredOutput),
        modelCallId: finalModelCallId,
        completedAt
      });
      const provenance = GenerationProvenanceSchema.parse({
        runId,
        modelCallId: finalModelCallId,
        tier,
        provider: provider.code,
        modelDefinitionId: model.id,
        immutableModelId: finalResult.immutableModelId,
        promptVersion: input.promptVersion,
        workflowVersion: input.workflowVersion,
        policyId: catalog.policy.id,
        policyVersion: catalog.policy.rowVersion,
        budget: { status: 'NOT_APPLICABLE', reason: 'NON_BILLABLE_LOCAL_FIXTURE' },
        usage: finalResult.usage,
        attemptCount: attempted.attempt,
        fallbackUsed: false,
        latencyMs: finalResult.latencyMs,
        completedAt
      });
      return { output, result: finalResult, provenance };
    } catch (cause) {
      await this.repository.fail({
        organizationId: input.context.organizationId,
        runId,
        errorCode: cause instanceof ProviderGenerationError ? cause.code : cause instanceof AgentKernelOutputRejectedError ? 'OUTPUT_REJECTED' : 'KERNEL_FAILED',
        completedAt: new Date().toISOString()
      });
      throw cause;
    }
  }
}
