import { z } from 'zod';

import { ProjectIdSchema, ProjectResponseSchema } from '../projects/project.schema';

export const BUSINESS_CONTEXT_COMPILER_VERSION = 'business-context-compiler-v1' as const;

export const BusinessContextTruthStatusSchema = z.enum(['SOURCE_GROUNDED', 'HUMAN_CONFIRMED']);
export const ExperienceApplicabilityStatusSchema = z.enum(['APPLICABLE', 'NOT_APPLICABLE', 'NEEDS_DECISION']);
export const BusinessContextItemKindSchema = z.enum(['OUTCOME', 'ACTOR', 'WORKFLOW', 'SUCCESS_MEASURE']);

export const BusinessContextItemSchema = z.object({
  id: z.string().regex(/^BC-(?:OUT|ACT|FLOW|MEASURE)-[A-F0-9]{16}$/u),
  kind: BusinessContextItemKindSchema,
  statement: z.string().min(1).max(5_000),
  truthStatus: BusinessContextTruthStatusSchema,
  sourceEntityId: z.string().min(1).max(200),
  sourceId: z.string().min(1).max(200).nullable()
}).strict();

export const BusinessContextUnknownSchema = z.object({
  code: z.enum([
    'UNKNOWN_BUSINESS_OUTCOME',
    'UNKNOWN_ACTOR',
    'UNKNOWN_OPERATING_WORKFLOW',
    'UNKNOWN_SUCCESS_MEASURE',
    'UNKNOWN_EXPERIENCE_APPLICABILITY'
  ]),
  question: z.string().min(1).max(1_000),
  whyItMatters: z.string().min(1).max(1_000)
}).strict();

export const ExperienceApplicabilitySchema = z.object({
  status: ExperienceApplicabilityStatusSchema,
  rationale: z.string().min(1).max(2_000),
  sourceEntityIds: z.array(z.string().min(1).max(200)).max(1_000),
  decisionRequired: z.boolean()
}).strict();

export const BusinessContextPreviewSchema = z.object({
  schemaVersion: z.literal('business-context-preview-v1'),
  compilerVersion: z.literal(BUSINESS_CONTEXT_COMPILER_VERSION),
  projectId: ProjectIdSchema,
  sourceGraphVersion: z.number().int().positive(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  compiledAt: z.iso.datetime(),
  applicability: ExperienceApplicabilitySchema,
  outcomes: z.array(BusinessContextItemSchema).max(1_000),
  actors: z.array(BusinessContextItemSchema).max(1_000),
  workflows: z.array(BusinessContextItemSchema).max(1_000),
  successMeasures: z.array(BusinessContextItemSchema).max(1_000),
  unknowns: z.array(BusinessContextUnknownSchema).max(5),
  blockingGapIds: z.array(z.string().min(1).max(200)).max(1_000),
  coverage: z.object({
    eligibleEntityCount: z.number().int().nonnegative(),
    classifiedEntityCount: z.number().int().nonnegative(),
    unclassifiedEntityIds: z.array(z.string().min(1).max(200)).max(1_000)
  }).strict()
}).strict();

export const BusinessContextVersionIdSchema = z.string().regex(/^BCV-[A-Za-z0-9_-]{1,123}$/u);
export const BusinessContextReviewIdSchema = z.string().regex(/^BCREV-[A-Za-z0-9_-]{1,121}$/u);
export const BusinessContextReviewDecisionSchema = z.enum(['ACCEPT', 'ACCEPT_WITH_EDITS', 'REJECT']);
export const BusinessContextFeedbackCategorySchema = z.enum([
  'APPROVAL',
  'BUSINESS_OUTCOME',
  'ACTOR',
  'WORKFLOW',
  'SUCCESS_MEASURE',
  'EXPERIENCE_APPLICABILITY',
  'SOURCE_GROUNDING',
  'OTHER'
]);

export const BusinessContextProposedGraphChangeSchema = z.object({
  target: z.enum(['OUTCOME', 'ACTOR', 'WORKFLOW', 'SUCCESS_MEASURE', 'EXPERIENCE_APPLICABILITY']),
  targetItemId: z.string().min(1).max(200).nullable(),
  proposedValue: z.string().trim().min(1).max(5_000),
  rationale: z.string().trim().min(10).max(2_000),
  status: z.literal('PROPOSED_GRAPH_MUTATION')
}).strict();

export const BusinessContextVersionSchema = z.object({
  id: BusinessContextVersionIdSchema,
  projectId: ProjectIdSchema,
  version: z.number().int().positive(),
  sourceGraphVersion: z.number().int().positive(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  compilerVersion: z.literal(BUSINESS_CONTEXT_COMPILER_VERSION),
  payload: BusinessContextPreviewSchema,
  generatedByUserId: z.string().min(1).max(160),
  generatedAt: z.iso.datetime()
}).strict().superRefine((value, context) => {
  if (value.payload.projectId !== value.projectId || value.payload.sourceGraphVersion !== value.sourceGraphVersion || value.payload.contentHash !== value.contentHash) {
    context.addIssue({ code: 'custom', message: 'Business Context version metadata must match its exact payload' });
  }
});

export const BusinessContextReviewSchema = z.object({
  id: BusinessContextReviewIdSchema,
  projectId: ProjectIdSchema,
  sourceGraphVersion: z.number().int().positive(),
  contextVersionId: BusinessContextVersionIdSchema,
  contextContentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  decision: BusinessContextReviewDecisionSchema,
  feedbackCategory: BusinessContextFeedbackCategorySchema,
  comment: z.string().min(10).max(2_000),
  proposedGraphChanges: z.array(BusinessContextProposedGraphChangeSchema).max(20),
  truthStatus: z.enum(['HUMAN_APPROVED', 'HUMAN_REVIEWED']),
  reviewedByUserId: z.string().min(1).max(160),
  reviewedAt: z.iso.datetime()
}).strict().superRefine((value, context) => {
  if (value.decision === 'ACCEPT' && (value.feedbackCategory !== 'APPROVAL' || value.proposedGraphChanges.length !== 0 || value.truthStatus !== 'HUMAN_APPROVED')) {
    context.addIssue({ code: 'custom', message: 'Accepted Business Context must be an unedited exact approval' });
  }
  if (value.decision === 'ACCEPT_WITH_EDITS' && (value.feedbackCategory === 'APPROVAL' || value.proposedGraphChanges.length === 0 || value.truthStatus !== 'HUMAN_REVIEWED')) {
    context.addIssue({ code: 'custom', message: 'Accept-with-edits requires proposed graph changes and is not an approval' });
  }
  if (value.decision === 'REJECT' && (value.feedbackCategory === 'APPROVAL' || value.proposedGraphChanges.length !== 0 || value.truthStatus !== 'HUMAN_REVIEWED')) {
    context.addIssue({ code: 'custom', message: 'Rejected Business Context must include categorized feedback without graph edits' });
  }
});

export const BusinessContextBaselineSchema = z.object({
  projectId: ProjectIdSchema,
  graphVersion: z.number().int().nonnegative(),
  version: BusinessContextVersionSchema.nullable(),
  review: BusinessContextReviewSchema.nullable()
}).strict().superRefine((value, context) => {
  if (value.review !== null && (value.version === null || value.review.contextVersionId !== value.version.id || value.review.contextContentHash !== value.version.contentHash)) {
    context.addIssue({ code: 'custom', message: 'Business Context review must reference the exact current version' });
  }
});

export const GenerateBusinessContextRequestSchema = z.object({
  sourceGraphVersion: z.number().int().positive(),
  previewContentHash: z.string().regex(/^[a-f0-9]{64}$/u)
}).strict();

export const ReviewBusinessContextRequestSchema = z.object({
  sourceGraphVersion: z.number().int().positive(),
  contextVersionId: BusinessContextVersionIdSchema,
  contextContentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  decision: BusinessContextReviewDecisionSchema,
  feedbackCategory: BusinessContextFeedbackCategorySchema,
  comment: z.string().trim().min(10).max(2_000),
  proposedGraphChanges: z.array(BusinessContextProposedGraphChangeSchema.omit({ status: true })).max(20).default([])
}).strict().superRefine((value, context) => {
  if (value.decision === 'ACCEPT' && (value.feedbackCategory !== 'APPROVAL' || value.proposedGraphChanges.length !== 0)) {
    context.addIssue({ code: 'custom', message: 'Accept requires approval category and no edits' });
  }
  if (value.decision === 'ACCEPT_WITH_EDITS' && (value.feedbackCategory === 'APPROVAL' || value.proposedGraphChanges.length === 0)) {
    context.addIssue({ code: 'custom', message: 'Accept-with-edits requires at least one proposed graph change' });
  }
  if (value.decision === 'REJECT' && (value.feedbackCategory === 'APPROVAL' || value.proposedGraphChanges.length !== 0)) {
    context.addIssue({ code: 'custom', message: 'Reject requires categorized feedback and no graph edits' });
  }
});

export const BusinessContextMutationResponseSchema = z.object({
  project: ProjectResponseSchema,
  baseline: BusinessContextBaselineSchema,
  replayed: z.boolean()
}).strict();

export type BusinessContextPreview = z.infer<typeof BusinessContextPreviewSchema>;
export type BusinessContextTruthStatus = z.infer<typeof BusinessContextTruthStatusSchema>;
export type BusinessContextVersion = z.infer<typeof BusinessContextVersionSchema>;
export type BusinessContextReview = z.infer<typeof BusinessContextReviewSchema>;
export type BusinessContextBaseline = z.infer<typeof BusinessContextBaselineSchema>;
export type BusinessContextProposedGraphChange = z.infer<typeof BusinessContextProposedGraphChangeSchema>;
