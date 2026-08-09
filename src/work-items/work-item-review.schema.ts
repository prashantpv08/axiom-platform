import { z } from 'zod';

import { WorkItemEstimateSchema, WorkItemIdSchema, WorkItemPrioritySchema } from './work-item.schema';

export const WorkItemReviewIdSchema = z.string().regex(/^WIREVIEW-[A-Za-z0-9_-]{1,120}$/u);
const ReviewedGenerationIdSchema = z.string().regex(/^WIGEN-[A-Za-z0-9_-]{1,123}$/u);
export const WorkItemGenerationReviewEtagSchema = z.string().regex(/^"WIGEN-[A-Za-z0-9_-]{1,123}:[a-f0-9]{64}"$/u);
export const WorkItemReviewDecisionSchema = z.enum(['ACCEPT', 'ACCEPT_WITH_EDITS', 'REJECT']);
export const WorkItemReviewReasonCategorySchema = z.enum([
  'MEETS_REQUIREMENTS',
  'SCOPE_ADJUSTMENT',
  'TECHNICAL_CORRECTION',
  'PRIORITY_OR_ESTIMATE',
  'MISSING_REQUIREMENT',
  'UNGROUNDED',
  'UNTESTABLE',
  'DUPLICATE_OR_OVERLAP',
  'DEPENDENCY_ERROR',
  'CRITICAL_UNKNOWN',
  'OTHER'
]);

const WorkItemEditSchema = z.object({
  workItemId: WorkItemIdSchema,
  expectedVersion: z.number().int().positive(),
  title: z.string().trim().min(8).max(180).optional(),
  priority: WorkItemPrioritySchema.optional(),
  estimate: WorkItemEstimateSchema.optional(),
  outcome: z.string().trim().min(20).max(2_000).optional(),
  context: z.string().trim().min(20).max(4_000).optional(),
  scope: z.array(z.string().trim().min(8).max(1_000)).min(1).max(30).optional(),
  outOfScope: z.array(z.string().trim().min(8).max(1_000)).max(30).optional()
}).strict().refine((value) => Object.keys(value).some((key) => !['workItemId', 'expectedVersion'].includes(key)), {
  message: 'Each work-item edit must change at least one editable field'
});

const ReviewCommentSchema = z.string().trim().min(10).max(2_000);

export const SubmitWorkItemReviewRequestSchema = z.discriminatedUnion('decision', [
  z.object({
    decision: z.literal('ACCEPT'),
    reasonCategory: z.literal('MEETS_REQUIREMENTS'),
    comment: ReviewCommentSchema
  }).strict(),
  z.object({
    decision: z.literal('ACCEPT_WITH_EDITS'),
    reasonCategory: z.enum(['SCOPE_ADJUSTMENT', 'TECHNICAL_CORRECTION', 'PRIORITY_OR_ESTIMATE', 'OTHER']),
    comment: ReviewCommentSchema,
    edits: z.array(WorkItemEditSchema).min(1).max(200).refine((edits) => new Set(edits.map((edit) => edit.workItemId)).size === edits.length, {
      message: 'A work item can be edited only once in a review'
    })
  }).strict(),
  z.object({
    decision: z.literal('REJECT'),
    reasonCategory: z.enum(['MISSING_REQUIREMENT', 'UNGROUNDED', 'UNTESTABLE', 'DUPLICATE_OR_OVERLAP', 'DEPENDENCY_ERROR', 'CRITICAL_UNKNOWN', 'OTHER']),
    comment: ReviewCommentSchema
  }).strict()
]);

export const WorkItemReviewRecordSchema = z.object({
  id: WorkItemReviewIdSchema,
  generationId: ReviewedGenerationIdSchema,
  decision: WorkItemReviewDecisionSchema,
  reasonCategory: WorkItemReviewReasonCategorySchema,
  comment: ReviewCommentSchema,
  generationContentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  reviewedContentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  reviewedByUserId: z.string().regex(/^USER-[A-Za-z0-9_-]{1,123}$/u),
  reviewedAt: z.iso.datetime()
}).strict();

export type SubmitWorkItemReviewRequest = z.infer<typeof SubmitWorkItemReviewRequestSchema>;
export type WorkItemReviewRecord = z.infer<typeof WorkItemReviewRecordSchema>;
