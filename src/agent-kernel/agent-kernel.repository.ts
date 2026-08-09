import type { GenerationUsage, ModelProviderCode } from './generation.schema';
import type { ModelTier } from './agent-kernel.schema';

export const AGENT_KERNEL_REPOSITORY = Symbol('AXIOM_AGENT_KERNEL_REPOSITORY');

export type BeginAgentRunInput = {
  id: string;
  organizationId: string;
  projectId: string | null;
  generationId: string;
  workflow: string;
  workflowVersion: string;
  promptVersion: string;
  policyId: string;
  policyVersion: number;
  tier: ModelTier;
  modelDefinitionId: string;
  contextHash: string;
  requestId: string;
  actorUserId: string;
};

export type RecordModelCallInput = {
  id: string;
  organizationId: string;
  runId: string;
  attempt: number;
  provider: ModelProviderCode;
  modelDefinitionId: string;
  immutableModelId: string;
  status: 'SUCCEEDED' | 'FAILED';
  requestHash: string;
  responseHash: string | null;
  providerRequestId: string | null;
  finishReason: string | null;
  usage: GenerationUsage | null;
  latencyMs: number;
  errorCode: string | null;
  retryable: boolean;
  occurredAt: string;
};

export type CompleteAgentRunInput = {
  organizationId: string;
  runId: string;
  outputHash: string;
  modelCallId: string;
  completedAt: string;
};

export type FailAgentRunInput = {
  organizationId: string;
  runId: string;
  errorCode: string;
  completedAt: string;
};

export interface AgentKernelRepository {
  begin(input: BeginAgentRunInput): Promise<void>;
  recordModelCall(input: RecordModelCallInput): Promise<void>;
  complete(input: CompleteAgentRunInput): Promise<void>;
  fail(input: FailAgentRunInput): Promise<void>;
}
