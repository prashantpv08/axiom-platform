import { z } from 'zod';

import { ModelProviderCodeSchema } from '../agent-kernel/generation.schema';

export const ModelProviderLifecycleSchema = z.enum(['LOCAL_ONLY', 'CANDIDATE', 'QUALIFIED', 'SUSPENDED', 'RETIRED']);
export const ModelExecutionStatusSchema = z.enum(['ENABLED', 'DISABLED']);
export const ModelDataPolicyStatusSchema = z.enum(['NO_EXTERNAL_TRANSFER', 'REQUIRES_REVIEW', 'APPROVED']);
export const ModelEvaluationStatusSchema = z.enum(['LOCAL_FIXTURE_ONLY', 'NOT_EVALUATED', 'QUALIFIED', 'FAILED']);

export const ModelProviderSchema = z.object({
  id: z.string().regex(/^MPROV-[A-Za-z0-9_-]{1,121}$/),
  code: ModelProviderCodeSchema,
  displayName: z.string().min(1).max(200),
  lifecycleStatus: ModelProviderLifecycleSchema,
  executionStatus: ModelExecutionStatusSchema,
  dataPolicyStatus: ModelDataPolicyStatusSchema,
  allowedRegions: z.array(z.string().min(1).max(100)).max(50),
  updatedAt: z.iso.datetime()
}).strict().superRefine((provider, context) => {
  if (provider.executionStatus === 'ENABLED' && !['LOCAL_ONLY', 'QUALIFIED'].includes(provider.lifecycleStatus)) {
    context.addIssue({ code: 'custom', message: 'Only local or qualified providers can be enabled', path: ['executionStatus'] });
  }
});

export const ModelDefinitionSchema = z.object({
  id: z.string().regex(/^MODEL-[A-Za-z0-9_-]{1,122}$/),
  providerId: ModelProviderSchema.shape.id,
  immutableModelId: z.string().min(1).max(300),
  displayName: z.string().min(1).max(200),
  lifecycleStatus: ModelProviderLifecycleSchema,
  executionStatus: ModelExecutionStatusSchema,
  capabilities: z.object({
    structuredOutput: z.boolean(),
    tools: z.boolean(),
    vision: z.boolean()
  }).strict(),
  contextWindowTokens: z.number().int().positive().nullable(),
  maxOutputTokens: z.number().int().positive().nullable(),
  pricing: z.discriminatedUnion('status', [
    z.object({ status: z.literal('NOT_APPLICABLE') }).strict(),
    z.object({ status: z.literal('UNVERIFIED') }).strict(),
    z.object({
      status: z.literal('VERIFIED'),
      currency: z.string().regex(/^[A-Z]{3}$/),
      inputMicrosPerMillionTokens: z.number().int().nonnegative(),
      cachedInputMicrosPerMillionTokens: z.number().int().nonnegative().nullable(),
      outputMicrosPerMillionTokens: z.number().int().nonnegative(),
      verifiedAt: z.iso.datetime()
    }).strict()
  ]),
  dataPolicyStatus: ModelDataPolicyStatusSchema,
  allowedRegions: z.array(z.string().min(1).max(100)).max(50),
  evaluation: z.object({
    status: ModelEvaluationStatusSchema,
    scores: z.record(z.string().min(1).max(100), z.number().min(0).max(1)),
    evaluationRunId: z.string().min(1).max(200).nullable(),
    evaluatedAt: z.iso.datetime().nullable()
  }).strict(),
  updatedAt: z.iso.datetime()
}).strict().superRefine((model, context) => {
  if (model.executionStatus === 'ENABLED' && !['LOCAL_ONLY', 'QUALIFIED'].includes(model.lifecycleStatus)) {
    context.addIssue({ code: 'custom', message: 'Only local or qualified models can be enabled', path: ['executionStatus'] });
  }
  if (model.executionStatus === 'ENABLED' && model.lifecycleStatus === 'QUALIFIED') {
    if (model.evaluation.status !== 'QUALIFIED') context.addIssue({ code: 'custom', message: 'Enabled hosted models require qualification evidence', path: ['evaluation', 'status'] });
    if (model.pricing.status !== 'VERIFIED') context.addIssue({ code: 'custom', message: 'Enabled hosted models require verified pricing', path: ['pricing', 'status'] });
    if (model.dataPolicyStatus !== 'APPROVED') context.addIssue({ code: 'custom', message: 'Enabled hosted models require an approved data policy', path: ['dataPolicyStatus'] });
    if (model.allowedRegions.length === 0) context.addIssue({ code: 'custom', message: 'Enabled hosted models require an approved region', path: ['allowedRegions'] });
  }
});

export const ModelPolicySchema = z.object({
  id: z.string().regex(/^MPOL-[A-Za-z0-9_-]{1,122}$/),
  organizationId: z.string().regex(/^ORG-[A-Za-z0-9_-]{1,124}$/),
  economyModelDefinitionId: ModelDefinitionSchema.shape.id,
  balancedModelDefinitionId: ModelDefinitionSchema.shape.id,
  bestModelDefinitionId: ModelDefinitionSchema.shape.id,
  rowVersion: z.number().int().positive(),
  updatedAt: z.iso.datetime()
}).strict();

export const ModelCatalogSchema = z.object({
  providers: z.array(ModelProviderSchema).max(50),
  models: z.array(ModelDefinitionSchema).max(500),
  policy: ModelPolicySchema
}).strict().superRefine((catalog, context) => {
  const modelById = new Map(catalog.models.map((model) => [model.id, model]));
  for (const [field, modelId] of [
    ['economyModelDefinitionId', catalog.policy.economyModelDefinitionId],
    ['balancedModelDefinitionId', catalog.policy.balancedModelDefinitionId],
    ['bestModelDefinitionId', catalog.policy.bestModelDefinitionId]
  ] as const) {
    const model = modelById.get(modelId);
    if (model === undefined || model.executionStatus !== 'ENABLED') {
      context.addIssue({ code: 'custom', message: 'Policy tiers must resolve to enabled model definitions', path: ['policy', field] });
    }
  }
});

export type ModelCatalog = z.infer<typeof ModelCatalogSchema>;
export type ModelProvider = z.infer<typeof ModelProviderSchema>;
export type ModelDefinition = z.infer<typeof ModelDefinitionSchema>;
export type ModelPolicy = z.infer<typeof ModelPolicySchema>;
