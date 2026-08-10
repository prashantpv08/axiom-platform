import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type { OrganizationAccessContext } from '../identity/identity.schema';
import { ApplicationError } from '../platform/application/application-error';
import {
  CLARIFICATION_REPOSITORY,
  ClarificationAlreadyAnsweredError,
  ClarificationIdempotencyConflictError,
  ClarificationInProgressError,
  ClarificationNotFoundError,
  ClarificationProjectStateError,
  ClarificationVersionConflictError,
  type ClarificationRepository
} from './clarification.repository';
import { AnswerClarificationRequestSchema, ClarificationQuestionIdSchema } from './clarification.schema';
import { IdempotencyKeySchema, ProjectIdSchema } from './project.schema';

@Injectable()
export class ClarificationService {
  constructor(@Inject(CLARIFICATION_REPOSITORY) private readonly repository: ClarificationRepository) {}

  async answer(
    context: OrganizationAccessContext,
    projectIdInput: unknown,
    questionIdInput: unknown,
    body: unknown,
    expectedRowVersion: number,
    idempotencyKeyInput: unknown,
    requestId: string
  ) {
    const projectId = ProjectIdSchema.safeParse(projectIdInput);
    const questionId = ClarificationQuestionIdSchema.safeParse(questionIdInput);
    if (!projectId.success || !questionId.success) throw new ApplicationError('NOT_FOUND', 'Project or clarification question was not found');
    const request = AnswerClarificationRequestSchema.safeParse(body);
    if (!request.success) throw new ApplicationError('INVALID_REQUEST', 'Clarification answer must contain 1 to 2000 characters');
    const idempotencyKey = IdempotencyKeySchema.safeParse(idempotencyKeyInput);
    if (!idempotencyKey.success) throw new ApplicationError('INVALID_REQUEST', 'A valid Idempotency-Key header is required');
    const requestHash = createHash('sha256').update(JSON.stringify({
      projectId: projectId.data,
      questionId: questionId.data,
      answer: request.data.answer,
      expectedRowVersion
    }), 'utf8').digest('hex');

    try {
      return await this.repository.answer(context.organizationId, {
        projectId: projectId.data,
        questionId: questionId.data,
        answer: request.data.answer,
        expectedRowVersion,
        idempotencyKey: idempotencyKey.data,
        requestHash,
        actorUserId: context.userId,
        sessionId: context.sessionId,
        requestId
      });
    } catch (cause) {
      if (cause instanceof ClarificationNotFoundError) throw new ApplicationError('NOT_FOUND', cause.message);
      if (cause instanceof ClarificationVersionConflictError) throw new ApplicationError('PRECONDITION_FAILED', cause.message);
      if (cause instanceof ClarificationAlreadyAnsweredError || cause instanceof ClarificationProjectStateError || cause instanceof ClarificationIdempotencyConflictError || cause instanceof ClarificationInProgressError) {
        throw new ApplicationError('CONFLICT', cause.message);
      }
      throw cause;
    }
  }
}
