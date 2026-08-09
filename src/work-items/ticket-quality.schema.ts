import { z } from 'zod';

import { TICKET_QUALITY_EVALUATOR_VERSION, WorkItemIdSchema } from './work-item.schema';

export const TicketQualityFindingCodeSchema = z.enum([
  'SCHEMA_INVALID',
  'DUPLICATE_ID',
  'INVALID_PARENT',
  'MISSING_PARENT',
  'MISSING_USER_STORY',
  'MISSING_DEFECT_DETAILS',
  'INCOMPLETE_IMPLEMENTABLE_ITEM',
  'INVALID_SOURCE_REFERENCE',
  'UNJUSTIFIED_WORK_ITEM',
  'VAGUE_ACCEPTANCE_CRITERION',
  'UNVERIFIABLE_ACCEPTANCE_CRITERION',
  'BLOCKING_OPEN_QUESTION',
  'UNKNOWN_DEPENDENCY',
  'DEPENDENCY_CYCLE',
  'OVERLAPPING_WORK_ITEM',
  'UNCOVERED_REQUIREMENT',
  'PROHIBITED_EVIDENCE_CLAIM'
]);

export const TicketQualityFindingSchema = z.object({
  code: TicketQualityFindingCodeSchema,
  severity: z.enum(['BLOCKER', 'ERROR', 'WARNING']),
  message: z.string().min(1),
  workItemId: WorkItemIdSchema.optional(),
  path: z.string().min(1).optional(),
  relatedIds: z.array(z.string().min(1)).optional()
}).strict();

export const TicketQualityReportSchema = z.object({
  evaluatorVersion: z.literal(TICKET_QUALITY_EVALUATOR_VERSION),
  passed: z.boolean(),
  clarificationRequired: z.boolean(),
  findings: z.array(TicketQualityFindingSchema),
  metrics: z.object({
    schemaValid: z.boolean(),
    workItemCount: z.number().int().nonnegative(),
    implementableWorkItemCount: z.number().int().nonnegative(),
    requiredFieldCompleteness: z.number().min(0).max(1),
    validSourceReferenceRate: z.number().min(0).max(1),
    approvedRequirementCoverage: z.number().min(0).max(1),
    duplicatePairCount: z.number().int().nonnegative(),
    blockingQuestionCount: z.number().int().nonnegative()
  }).strict()
}).strict();

export type TicketQualityFinding = z.infer<typeof TicketQualityFindingSchema>;
export type TicketQualityReport = z.infer<typeof TicketQualityReportSchema>;
