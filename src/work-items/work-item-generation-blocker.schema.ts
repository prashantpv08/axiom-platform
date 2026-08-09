import { z } from 'zod';

import { SourceEntityIdSchema } from './work-item.schema';

export const WorkItemGenerationBlockerSchema = z.object({
  gapId: z.string().min(1).max(200),
  type: z.string().min(1).max(100),
  category: z.string().min(1).max(100),
  title: z.string().min(1).max(500),
  description: z.string().min(1).max(2_000),
  severity: z.string().min(1).max(100),
  truthStatus: z.literal('UNKNOWN'),
  clarification: z.object({
    id: z.string().min(1).max(200),
    question: z.string().min(1).max(1_000),
    whyItMatters: z.string().min(1).max(1_000),
    affectedEntityIds: z.array(SourceEntityIdSchema).max(100)
  }).strict().nullable()
}).strict();

export const WorkItemGenerationBlockedDetailsSchema = z.object({
  blockers: z.array(WorkItemGenerationBlockerSchema).min(1).max(100)
}).strict();

export type WorkItemGenerationBlocker = z.infer<typeof WorkItemGenerationBlockerSchema>;
