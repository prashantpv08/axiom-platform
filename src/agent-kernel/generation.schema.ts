import { z } from 'zod';

export const ModelProviderCodeSchema = z.enum(['LOCAL_FIXTURE', 'OPENAI', 'GROQ']);
export type ModelProviderCode = z.infer<typeof ModelProviderCodeSchema>;

export const GenerationMessageSchema = z.object({
  role: z.enum(['SYSTEM', 'USER', 'ASSISTANT']),
  content: z.string().min(1).max(100_000)
}).strict();

export const JsonSchemaDocumentSchema = z.record(z.string().min(1).max(200), z.unknown());

export const GenerationToolSchema = z.object({
  name: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),
  description: z.string().min(1).max(2_000),
  inputSchema: JsonSchemaDocumentSchema
}).strict();

export const StructuredOutputContractSchema = z.object({
  name: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/),
  version: z.string().min(1).max(100),
  jsonSchema: JsonSchemaDocumentSchema
}).strict();

export const GenerationRequestSchema = z.object({
  organizationId: z.string().regex(/^ORG-[A-Za-z0-9_-]{1,124}$/),
  projectId: z.string().regex(/^PROJ-[A-Za-z0-9_-]{1,123}$/).nullable(),
  runId: z.string().regex(/^ARUN-[A-Za-z0-9_-]{1,123}$/),
  generationId: z.string().regex(/^(?:GEN|WIGEN|EPLAN)-[A-Za-z0-9_-]{1,124}$/),
  workflow: z.string().regex(/^[a-z][a-z0-9-]{1,99}$/),
  workflowVersion: z.string().min(1).max(100),
  modelDefinitionId: z.string().regex(/^MODEL-[A-Za-z0-9_-]{1,122}$/),
  safetyIdentifier: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  messages: z.array(GenerationMessageSchema).min(1).max(100),
  structuredOutput: StructuredOutputContractSchema,
  tools: z.array(GenerationToolSchema).max(32).default([]),
  maxOutputTokens: z.number().int().min(1).max(200_000),
  timeoutMs: z.number().int().min(100).max(300_000)
}).strict();
export type GenerationRequest = z.infer<typeof GenerationRequestSchema>;
export type GenerationMessage = z.infer<typeof GenerationMessageSchema>;
export type StructuredOutputContract = z.infer<typeof StructuredOutputContractSchema>;

const MeasuredGenerationUsageSchema = z.object({
  evidenceStatus: z.literal('MEASURED'),
  measurementSource: z.literal('PROVIDER_RESPONSE'),
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative()
}).strict().superRefine((usage, context) => {
  if (usage.cachedInputTokens > usage.inputTokens) {
    context.addIssue({ code: 'custom', message: 'Cached input tokens cannot exceed input tokens', path: ['cachedInputTokens'] });
  }
  if (usage.totalTokens !== usage.inputTokens + usage.outputTokens) {
    context.addIssue({ code: 'custom', message: 'Total tokens must equal input plus output tokens', path: ['totalTokens'] });
  }
});

const FixtureGenerationUsageSchema = z.object({
  evidenceStatus: z.literal('NOT_APPLICABLE'),
  reason: z.literal('NON_BILLABLE_LOCAL_FIXTURE')
}).strict();

export const GenerationUsageSchema = z.discriminatedUnion('evidenceStatus', [
  MeasuredGenerationUsageSchema,
  FixtureGenerationUsageSchema
]);
export type GenerationUsage = z.infer<typeof GenerationUsageSchema>;

export const GenerationToolCallSchema = z.object({
  id: z.string().min(1).max(200),
  name: GenerationToolSchema.shape.name,
  arguments: z.unknown()
}).strict();

export const GenerationResultSchema = z.object({
  provider: ModelProviderCodeSchema,
  providerRequestId: z.string().min(1).max(300).nullable(),
  immutableModelId: z.string().min(1).max(300),
  finishReason: z.enum(['COMPLETE', 'LENGTH', 'TOOL_CALLS', 'CONTENT_FILTERED']),
  structuredOutput: z.unknown(),
  toolCalls: z.array(GenerationToolCallSchema).max(64),
  usage: GenerationUsageSchema,
  latencyMs: z.number().int().nonnegative(),
  completedAt: z.iso.datetime()
}).strict();
export type GenerationResult = z.infer<typeof GenerationResultSchema>;

export const GenerationErrorCodeSchema = z.enum([
  'AUTHENTICATION_FAILED',
  'RATE_LIMITED',
  'TIMEOUT',
  'PROVIDER_UNAVAILABLE',
  'INVALID_REQUEST',
  'INVALID_RESPONSE',
  'CONTENT_BLOCKED',
  'CANCELLED'
]);
export type GenerationErrorCode = z.infer<typeof GenerationErrorCodeSchema>;

export const GenerationErrorSchema = z.object({
  code: GenerationErrorCodeSchema,
  message: z.string().min(1).max(500),
  retryable: z.boolean(),
  providerRequestId: z.string().min(1).max(300).nullable()
}).strict();
