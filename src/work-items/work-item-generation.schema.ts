import { z } from 'zod';

import { GenerationProvenanceSchema, ModelTierSchema } from '../agent-kernel/agent-kernel.schema';
import { ProjectIdSchema } from '../projects/project.schema';
import { TicketQualityReportSchema } from './ticket-quality.schema';
import { WorkItemReviewRecordSchema } from './work-item-review.schema';
import { WorkItemSchema } from './work-item.schema';

export const WorkItemGenerationIdSchema = z.string().regex(/^WIGEN-[A-Za-z0-9_-]{1,123}$/u);

export const GenerateWorkItemsRequestSchema = z.object({
  sourceGraphVersion: z.number().int().positive(),
  tier: ModelTierSchema.default('BALANCED')
}).strict();

export const WorkItemGenerationPreviewSchema = z.object({
  id: WorkItemGenerationIdSchema,
  projectId: ProjectIdSchema,
  sourceGraphVersion: z.number().int().positive(),
  status: z.enum(['DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'SUPERSEDED']),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  generationContentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  schemaVersion: z.literal('work-item-v1'),
  evaluatorVersion: z.literal('ticket-quality-v1'),
  promptVersion: z.literal('fixture-grounded-agile-v1'),
  workflowVersion: z.literal('ticket-workflow-v1'),
  provenance: GenerationProvenanceSchema.nullable(),
  qualityReport: TicketQualityReportSchema,
  workItems: z.array(WorkItemSchema).min(1).max(200),
  generatedAt: z.iso.datetime(),
  review: WorkItemReviewRecordSchema.nullable(),
  replayed: z.boolean()
}).strict();

export type WorkItemGenerationPreview = z.infer<typeof WorkItemGenerationPreviewSchema>;
