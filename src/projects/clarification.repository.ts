import type { ClarificationAnswerResponse } from './clarification.schema';

export const CLARIFICATION_REPOSITORY = Symbol('AXIOM_CLARIFICATION_REPOSITORY');

export type AnswerClarificationInput = {
  projectId: string;
  questionId: string;
  answer: string;
  expectedRowVersion: number;
  idempotencyKey: string;
  requestHash: string;
  actorUserId: string;
  sessionId: string;
  requestId: string;
};

export class ClarificationNotFoundError extends Error {}
export class ClarificationAlreadyAnsweredError extends Error {}
export class ClarificationProjectStateError extends Error {}
export class ClarificationIdempotencyConflictError extends Error {}
export class ClarificationInProgressError extends Error {}
export class ClarificationVersionConflictError extends Error {}

export interface ClarificationRepository {
  answer(organizationId: string, input: AnswerClarificationInput): Promise<ClarificationAnswerResponse>;
}
