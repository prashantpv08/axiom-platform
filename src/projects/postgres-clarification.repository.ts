import { createHash, randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';

import type { AxiomDatabase } from '../database/client';
import { DATABASE } from '../database/database.module';
import {
  claimPostgresIdempotency,
  completePostgresIdempotency
} from '../database/idempotency/postgres-idempotency';
import {
  auditEvents,
  clarificationQuestions,
  knowledgeEntities,
  projectGaps,
  projectGraphs,
  projects
} from '../database/schema';
import { isCriticalGenerationGap } from '../work-items/work-item-generation-blocker.policy';
import { clarificationAnswerEntityId, transitionClarificationAnswer } from './clarification-answer.policy';
import {
  ClarificationAlreadyAnsweredError,
  ClarificationIdempotencyConflictError,
  ClarificationInProgressError,
  ClarificationNotFoundError,
  ClarificationProjectStateError,
  ClarificationVersionConflictError,
  type AnswerClarificationInput,
  type ClarificationRepository
} from './clarification.repository';
import { ClarificationAnswerResponseSchema } from './clarification.schema';
import { calculateProjectReadiness } from './project-readiness.policy';
import { ProjectResponseSchema } from './project.schema';

@Injectable()
export class PostgresClarificationRepository implements ClarificationRepository {
  constructor(@Inject(DATABASE) private readonly database: AxiomDatabase) {}

  async answer(organizationId: string, input: AnswerClarificationInput) {
    return this.database.transaction(async (transaction) => {
      const reservation = await claimPostgresIdempotency(transaction, {
        organizationId,
        scope: 'CLARIFICATION_ANSWER',
        key: input.idempotencyKey,
        requestHash: input.requestHash
      });
      if (reservation.kind === 'HASH_CONFLICT') {
        throw new ClarificationIdempotencyConflictError('Idempotency key was used for another clarification answer');
      }
      if (reservation.kind === 'REPLAY') {
        return ClarificationAnswerResponseSchema.parse({ ...reservation.responsePayload, replayed: true });
      }
      if (reservation.kind === 'IN_PROGRESS') {
        throw new ClarificationInProgressError('Clarification answer with this idempotency key is still processing');
      }

      const [currentProject] = await transaction.select().from(projects).where(and(
        eq(projects.organizationId, organizationId),
        eq(projects.id, input.projectId)
      )).limit(1).for('update');
      if (currentProject === undefined) throw new ClarificationNotFoundError('Project or clarification question was not found');
      if (currentProject.rowVersion !== input.expectedRowVersion) throw new ClarificationVersionConflictError('Project has changed since the clarification was loaded');
      if (currentProject.status === 'ARCHIVED' || currentProject.graphVersion < 1) throw new ClarificationProjectStateError('Project is not ready for clarification answers');

      const [graph] = await transaction.select().from(projectGraphs).where(and(
        eq(projectGraphs.organizationId, organizationId),
        eq(projectGraphs.projectId, input.projectId),
        eq(projectGraphs.graphVersion, currentProject.graphVersion)
      )).limit(1);
      const [question] = await transaction.select().from(clarificationQuestions).where(and(
        eq(clarificationQuestions.organizationId, organizationId),
        eq(clarificationQuestions.projectId, input.projectId),
        eq(clarificationQuestions.graphVersion, currentProject.graphVersion),
        eq(clarificationQuestions.id, input.questionId)
      )).limit(1).for('update');
      if (graph === undefined || question === undefined) throw new ClarificationNotFoundError('Project or clarification question was not found');
      if (question.status !== 'OPEN') throw new ClarificationAlreadyAnsweredError('Clarification question is already answered');

      const [gaps, questions, entities] = await Promise.all([
        transaction.select().from(projectGaps).where(and(
          eq(projectGaps.organizationId, organizationId),
          eq(projectGaps.projectId, input.projectId),
          eq(projectGaps.graphVersion, currentProject.graphVersion)
        )),
        transaction.select().from(clarificationQuestions).where(and(
          eq(clarificationQuestions.organizationId, organizationId),
          eq(clarificationQuestions.projectId, input.projectId),
          eq(clarificationQuestions.graphVersion, currentProject.graphVersion)
        )),
        transaction.select().from(knowledgeEntities).where(and(
          eq(knowledgeEntities.organizationId, organizationId),
          eq(knowledgeEntities.projectId, input.projectId),
          eq(knowledgeEntities.graphVersion, currentProject.graphVersion)
        ))
      ]);
      const gap = gaps.find((item) => item.id === question.gapId);
      if (gap === undefined) throw new ClarificationNotFoundError('Clarification gap was not found');
      let transition;
      try {
        transition = transitionClarificationAnswer({ questionStatus: question.status, gapStatus: gap.status, gapCategory: gap.category });
      } catch (cause) {
        throw new ClarificationAlreadyAnsweredError(cause instanceof Error ? cause.message : 'Clarification cannot be answered');
      }

      const answeredAt = new Date().toISOString();
      const nextGraphVersion = currentProject.graphVersion + 1;
      const nextGaps = gaps.map((item) => item.id === gap.id
        ? { ...item, graphVersion: nextGraphVersion, status: transition.gapStatus, truthStatus: transition.truthStatus }
        : { ...item, graphVersion: nextGraphVersion });
      const nextQuestions = questions.map((item) => item.id === question.id
        ? { ...item, graphVersion: nextGraphVersion, status: transition.questionStatus, answer: input.answer, answeredAt, truthStatus: transition.truthStatus }
        : { ...item, graphVersion: nextGraphVersion });
      const nextStatus = nextGaps.some(isCriticalGenerationGap) ? 'NEEDS_CLARIFICATION' as const : 'ANALYZED' as const;
      const answerEntityId = clarificationAnswerEntityId(input.projectId, question.id);
      const nextEntityPosition = entities.reduce((maximum, entity) => Math.max(maximum, entity.position), -1) + 1;
      const carriedEntities = entities.filter((entity) => entity.id !== answerEntityId).map((entity) => ({ ...entity, graphVersion: nextGraphVersion }));
      const answerEntity = {
        id: answerEntityId,
        organizationId,
        projectId: input.projectId,
        graphVersion: nextGraphVersion,
        category: transition.answerEntityCategory,
        text: `${question.question} Human-confirmed answer: ${input.answer}`,
        truthStatus: transition.truthStatus,
        sourceId: null,
        clarificationQuestionId: question.id,
        quote: null,
        startOffset: null,
        endOffset: null,
        position: nextEntityPosition
      };
      const readiness = calculateProjectReadiness({ entities: [...carriedEntities, answerEntity], gaps: nextGaps, calculatedAt: answeredAt });

      await transaction.insert(projectGraphs).values({
        organizationId,
        projectId: input.projectId,
        graphVersion: nextGraphVersion,
        summary: graph.summary,
        readiness,
        analyzer: 'axiom-human-clarification-v1',
        analyzedAt: answeredAt
      });
      if (nextGaps.length > 0) await transaction.insert(projectGaps).values(nextGaps);
      if (nextQuestions.length > 0) await transaction.insert(clarificationQuestions).values(nextQuestions);
      if (carriedEntities.length > 0) await transaction.insert(knowledgeEntities).values(carriedEntities);
      await transaction.insert(knowledgeEntities).values(answerEntity);

      const [updatedProject] = await transaction.update(projects).set({
        graphVersion: nextGraphVersion,
        status: nextStatus,
        rowVersion: sql`${projects.rowVersion} + 1`,
        updatedAt: answeredAt
      }).where(and(
        eq(projects.organizationId, organizationId),
        eq(projects.id, input.projectId),
        eq(projects.rowVersion, input.expectedRowVersion)
      )).returning();
      if (updatedProject === undefined) throw new ClarificationVersionConflictError('Project has changed since the clarification was loaded');

      const project = ProjectResponseSchema.parse({
        id: updatedProject.id,
        workspaceId: updatedProject.workspaceId,
        name: updatedProject.name,
        status: updatedProject.status,
        graphVersion: updatedProject.graphVersion,
        rowVersion: updatedProject.rowVersion,
        archivedAt: updatedProject.archivedAt === null ? null : new Date(updatedProject.archivedAt).toISOString(),
        createdAt: new Date(updatedProject.createdAt).toISOString(),
        updatedAt: new Date(updatedProject.updatedAt).toISOString()
      });
      const response = ClarificationAnswerResponseSchema.parse({
        project,
        clarification: {
          id: question.id,
          gapId: question.gapId,
          status: transition.questionStatus,
          truthStatus: transition.truthStatus,
          answeredAt
        },
        previousGraphVersion: currentProject.graphVersion,
        graphVersion: nextGraphVersion,
        readiness,
        replayed: false
      });
      await transaction.insert(auditEvents).values({
        id: `AUDIT-${randomUUID()}`,
        organizationId,
        actorUserId: input.actorUserId,
        action: 'CLARIFICATION_ANSWERED',
        targetType: 'ClarificationQuestion',
        targetId: question.id,
        requestId: input.requestId,
        metadata: {
          projectId: input.projectId,
          gapId: question.gapId,
          previousGraphVersion: currentProject.graphVersion,
          graphVersion: nextGraphVersion,
          previousProjectStatus: currentProject.status,
          projectStatus: nextStatus,
          readinessScore: readiness.score,
          readinessRawScore: readiness.rawScore,
          answerHash: createHash('sha256').update(input.answer, 'utf8').digest('hex'),
          sessionId: input.sessionId
        }
      });
      await completePostgresIdempotency(transaction, {
        recordId: reservation.recordId,
        responseStatus: 200,
        responsePayload: response,
        completedAt: answeredAt
      });
      return response;
    });
  }
}
