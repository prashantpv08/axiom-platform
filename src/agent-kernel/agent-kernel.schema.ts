import { z } from 'zod';

import { GenerationResultSchema, GenerationUsageSchema, ModelProviderCodeSchema } from './generation.schema';

export const ModelTierSchema = z.enum(['ECONOMY', 'BALANCED', 'BEST']);
export type ModelTier = z.infer<typeof ModelTierSchema>;

export const AgentRunIdSchema = z.string().regex(/^ARUN-[A-Za-z0-9_-]{1,123}$/u);
export const ModelCallIdSchema = z.string().regex(/^MCALL-[A-Za-z0-9_-]{1,122}$/u);
export const PromptVersionIdSchema = z.string().regex(/^PROMPT-[A-Za-z0-9_-]{1,120}$/u);
export const AgentWorkflowVersionIdSchema = z.string().regex(/^AWFV-[A-Za-z0-9_-]{1,122}$/u);

export const GenerationProvenanceSchema = z.object({
  runId: AgentRunIdSchema,
  modelCallId: ModelCallIdSchema,
  tier: ModelTierSchema,
  provider: ModelProviderCodeSchema,
  modelDefinitionId: z.string().regex(/^MODEL-[A-Za-z0-9_-]{1,122}$/u),
  immutableModelId: z.string().min(1).max(300),
  promptVersion: z.string().min(1).max(100),
  workflowVersion: z.string().min(1).max(100),
  policyId: z.string().regex(/^MPOL-[A-Za-z0-9_-]{1,122}$/u),
  policyVersion: z.number().int().positive(),
  budget: z.discriminatedUnion('status', [
    z.object({ status: z.literal('NOT_APPLICABLE'), reason: z.literal('NON_BILLABLE_LOCAL_FIXTURE') }).strict(),
    z.object({ status: z.literal('RESERVED'), reservationId: z.string().regex(/^URES-[A-Za-z0-9_-]{1,123}$/u) }).strict()
  ]),
  usage: GenerationUsageSchema,
  attemptCount: z.number().int().min(1).max(3),
  fallbackUsed: z.boolean(),
  latencyMs: z.number().int().nonnegative(),
  completedAt: z.iso.datetime()
}).strict();

export const AgentKernelResultSchema = z.object({
  generation: GenerationResultSchema,
  provenance: GenerationProvenanceSchema,
  validatedOutput: z.unknown()
}).strict();

export type GenerationProvenance = z.infer<typeof GenerationProvenanceSchema>;
