import { z } from 'zod';

export const WORK_ITEM_SCHEMA_VERSION = 'work-item-v1' as const;
export const TICKET_QUALITY_EVALUATOR_VERSION = 'ticket-quality-v1' as const;

export const WorkItemIdSchema = z.string().regex(/^WI-[A-Za-z0-9_-]{1,125}$/u);
export const WorkItemTypeSchema = z.enum(['INITIATIVE', 'EPIC', 'STORY', 'TASK', 'DEFECT']);
export const WorkItemPrioritySchema = z.enum(['P0', 'P1', 'P2', 'P3']);
export const WorkItemEstimateSchema = z.enum(['XS', 'S', 'M', 'L', 'XL', 'UNKNOWN']);
export const SourceEntityIdSchema = z.string().regex(/^[A-Z][A-Z0-9_]*-[A-Za-z0-9_-]{1,120}$/u);

export const EvaluationSourceEntitySchema = z.object({
  id: SourceEntityIdSchema,
  kind: z.enum(['REQUIREMENT', 'NFR', 'DECISION', 'CONSTRAINT', 'RISK', 'SOURCE_SPAN']),
  truthStatus: z.enum(['SOURCE_GROUNDED', 'HUMAN_CONFIRMED'])
}).strict();

export const AcceptanceCriterionSchema = z.object({
  id: z.string().regex(/^AC-[A-Za-z0-9_-]{1,125}$/u),
  statement: z.string().trim().min(15).max(1_000),
  verificationKind: z.enum(['AUTOMATED_TEST', 'INTEGRATION_TEST', 'CONTRACT_TEST', 'MANUAL_REVIEW', 'METRIC']),
  verificationMethod: z.string().trim().min(10).max(1_000),
  sourceEntityIds: z.array(SourceEntityIdSchema).min(1).max(20)
}).strict();

export const WorkItemRiskSchema = z.object({
  description: z.string().trim().min(10).max(500),
  impact: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  mitigation: z.string().trim().min(10).max(500)
}).strict();

export const WorkItemOpenQuestionSchema = z.object({
  id: z.string().regex(/^QUESTION-[A-Za-z0-9_-]{1,120}$/u),
  question: z.string().trim().min(10).max(500),
  whyItMatters: z.string().trim().min(10).max(500),
  blocking: z.boolean(),
  affectedSourceEntityIds: z.array(SourceEntityIdSchema).max(20)
}).strict();

export const WorkItemSchema = z.object({
  id: WorkItemIdSchema,
  version: z.number().int().positive(),
  type: WorkItemTypeSchema,
  parentId: WorkItemIdSchema.nullable(),
  title: z.string().trim().min(8).max(180),
  priority: WorkItemPrioritySchema,
  estimate: WorkItemEstimateSchema,
  outcome: z.string().trim().min(20).max(2_000),
  context: z.string().trim().min(20).max(4_000),
  scope: z.array(z.string().trim().min(8).max(1_000)).min(1).max(30),
  outOfScope: z.array(z.string().trim().min(8).max(1_000)).max(30),
  acceptanceCriteria: z.array(AcceptanceCriterionSchema).max(30),
  dependencyIds: z.array(WorkItemIdSchema).max(30),
  risks: z.array(WorkItemRiskSchema).max(20),
  openQuestions: z.array(WorkItemOpenQuestionSchema).max(20),
  evidenceExpectations: z.array(z.string().trim().min(10).max(1_000)).max(20),
  sourceEntityIds: z.array(SourceEntityIdSchema).min(1).max(50),
  userStory: z.object({
    persona: z.string().trim().min(2).max(200),
    capability: z.string().trim().min(10).max(500),
    benefit: z.string().trim().min(10).max(500)
  }).strict().optional(),
  defect: z.object({
    observedBehavior: z.string().trim().min(10).max(1_000),
    expectedBehavior: z.string().trim().min(10).max(1_000),
    reproductionSteps: z.array(z.string().trim().min(5).max(500)).min(1).max(20)
  }).strict().optional(),
  truthStatus: z.literal('AI_SUGGESTED'),
  reviewStatus: z.literal('DRAFT')
}).strict();

export const WorkItemBatchSchema = z.object({
  schemaVersion: z.literal(WORK_ITEM_SCHEMA_VERSION),
  promptVersion: z.string().min(1).max(100),
  workflowVersion: z.string().min(1).max(100),
  projectId: z.string().regex(/^PROJ-[A-Za-z0-9_-]{1,123}$/u),
  sourceGraphVersion: z.number().int().positive(),
  generatedAt: z.iso.datetime(),
  workItems: z.array(WorkItemSchema).min(1).max(200)
}).strict();

export type WorkItem = z.infer<typeof WorkItemSchema>;
export type WorkItemBatch = z.infer<typeof WorkItemBatchSchema>;
export type EvaluationSourceEntity = z.infer<typeof EvaluationSourceEntitySchema>;

export const TicketQualityEvaluationInputSchema = z.object({
  batch: z.unknown(),
  sourceEntities: z.array(EvaluationSourceEntitySchema).max(5_000),
  approvedRequirementIds: z.array(SourceEntityIdSchema).max(2_000)
}).strict();
