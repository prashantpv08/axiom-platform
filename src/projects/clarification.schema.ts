import { z } from 'zod';

import { ProjectResponseSchema } from './project.schema';
import { ProjectReadinessSchema } from './project-readiness.policy';

export const ClarificationQuestionIdSchema = z.string().regex(/^(?:CQ|QUESTION)-[A-Za-z0-9_-]{1,120}$/u);

export const AnswerClarificationRequestSchema = z.object({
  answer: z.string().trim().min(1).max(2_000)
}).strict();

export const ClarificationAnswerResponseSchema = z.object({
  project: ProjectResponseSchema,
  clarification: z.object({
    id: ClarificationQuestionIdSchema,
    gapId: z.string().min(1).max(200),
    status: z.literal('ANSWERED'),
    truthStatus: z.literal('HUMAN_CONFIRMED'),
    answeredAt: z.iso.datetime()
  }).strict(),
  previousGraphVersion: z.number().int().positive(),
  graphVersion: z.number().int().positive(),
  readiness: ProjectReadinessSchema,
  replayed: z.boolean()
}).strict();

export type ClarificationAnswerResponse = z.infer<typeof ClarificationAnswerResponseSchema>;
