import { createHash, randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

import type { AxiomDatabase } from '../database/client';
import { DATABASE } from '../database/database.module';
import { claimPostgresIdempotency, completePostgresIdempotency } from '../database/idempotency/postgres-idempotency';
import {
  auditEvents,
  businessContextReviews,
  businessContextVersions,
  clarificationQuestions,
  experienceApplicabilityDecisions,
  knowledgeEntities,
  projectGaps,
  projectGraphs,
  projects
} from '../database/schema';
import { isCriticalProjectGap } from '../projects/project-gap.policy';
import { calculateProjectReadiness } from '../projects/project-readiness.policy';
import { ProjectResponseSchema } from '../projects/project.schema';
import { compileBusinessContext } from './business-context.compiler';
import {
  BusinessContextBlockedError,
  BusinessContextConflictError,
  BusinessContextNotFoundError,
  BusinessContextVersionConflictError,
  type BusinessContextGenerationInput,
  type BusinessContextRepository,
  type BusinessContextReviewInput,
  type BusinessContextSnapshot,
  type ExperienceApplicabilityDecisionInput
} from './business-context.repository';
import {
  BusinessContextBaselineSchema,
  BusinessContextMutationResponseSchema,
  BusinessContextReviewSchema,
  BusinessContextTruthStatusSchema,
  BusinessContextVersionSchema,
  ExperienceApplicabilityDecisionResponseSchema,
  ExperienceApplicabilityDecisionSchema,
  type BusinessContextBaseline,
  type BusinessContextReview,
  type BusinessContextVersion
} from './business-context.schema';

type DatabaseExecutor = Pick<AxiomDatabase, 'select'>;

function projectResponse(project: typeof projects.$inferSelect) {
  return ProjectResponseSchema.parse({
    id: project.id,
    workspaceId: project.workspaceId,
    name: project.name,
    status: project.status,
    graphVersion: project.graphVersion,
    rowVersion: project.rowVersion,
    archivedAt: project.archivedAt === null ? null : new Date(project.archivedAt).toISOString(),
    createdAt: new Date(project.createdAt).toISOString(),
    updatedAt: new Date(project.updatedAt).toISOString()
  });
}

function versionFromRow(row: typeof businessContextVersions.$inferSelect): BusinessContextVersion {
  return BusinessContextVersionSchema.parse({
    id: row.id,
    projectId: row.projectId,
    version: row.version,
    sourceGraphVersion: row.graphVersion,
    contentHash: row.contentHash,
    compilerVersion: row.compilerVersion,
    payload: row.payload,
    generatedByUserId: row.generatedByUserId,
    generatedAt: new Date(row.generatedAt).toISOString()
  });
}

function reviewFromRow(row: typeof businessContextReviews.$inferSelect): BusinessContextReview {
  return BusinessContextReviewSchema.parse({
    id: row.id,
    projectId: row.projectId,
    sourceGraphVersion: row.graphVersion,
    contextVersionId: row.contextVersionId,
    contextContentHash: row.contextContentHash,
    decision: row.decision,
    feedbackCategory: row.feedbackCategory,
    comment: row.comment,
    proposedGraphChanges: row.proposedGraphChanges,
    truthStatus: row.truthStatus,
    reviewedByUserId: row.reviewedByUserId,
    reviewedAt: new Date(row.reviewedAt).toISOString()
  });
}

async function baselineFor(executor: DatabaseExecutor, organizationId: string, projectId: string, graphVersion: number): Promise<BusinessContextBaseline> {
  const [row] = await executor.select().from(businessContextVersions).where(and(
    eq(businessContextVersions.organizationId, organizationId),
    eq(businessContextVersions.projectId, projectId),
    eq(businessContextVersions.graphVersion, graphVersion)
  )).orderBy(desc(businessContextVersions.version)).limit(1);
  if (row === undefined) return BusinessContextBaselineSchema.parse({ projectId, graphVersion, version: null, review: null });
  const version = versionFromRow(row);
  const [reviewRow] = await executor.select().from(businessContextReviews).where(and(
    eq(businessContextReviews.organizationId, organizationId),
    eq(businessContextReviews.projectId, projectId),
    eq(businessContextReviews.contextVersionId, version.id)
  )).limit(1);
  return BusinessContextBaselineSchema.parse({
    projectId,
    graphVersion,
    version,
    review: reviewRow === undefined ? null : reviewFromRow(reviewRow)
  });
}

async function snapshotForGraph(executor: DatabaseExecutor, organizationId: string, projectId: string, graphVersion: number): Promise<BusinessContextSnapshot> {
  const [graph, entityRows, gapRows] = await Promise.all([
    executor.select({ analyzedAt: projectGraphs.analyzedAt }).from(projectGraphs).where(and(
      eq(projectGraphs.organizationId, organizationId),
      eq(projectGraphs.projectId, projectId),
      eq(projectGraphs.graphVersion, graphVersion)
    )).limit(1),
    executor.select({
      id: knowledgeEntities.id,
      category: knowledgeEntities.category,
      text: knowledgeEntities.text,
      truthStatus: knowledgeEntities.truthStatus,
      sourceId: knowledgeEntities.sourceId
    }).from(knowledgeEntities).where(and(
      eq(knowledgeEntities.organizationId, organizationId),
      eq(knowledgeEntities.projectId, projectId),
      eq(knowledgeEntities.graphVersion, graphVersion),
      inArray(knowledgeEntities.truthStatus, ['SOURCE_GROUNDED', 'HUMAN_CONFIRMED'])
    )).orderBy(asc(knowledgeEntities.position)),
    executor.select({
      id: projectGaps.id,
      type: projectGaps.type,
      severity: projectGaps.severity,
      status: projectGaps.status,
      truthStatus: projectGaps.truthStatus
    }).from(projectGaps).where(and(
      eq(projectGaps.organizationId, organizationId),
      eq(projectGaps.projectId, projectId),
      eq(projectGaps.graphVersion, graphVersion)
    )).orderBy(asc(projectGaps.position))
  ]);
  return {
    projectId,
    graphVersion,
    analyzedAt: graph[0] === undefined ? null : new Date(graph[0].analyzedAt).toISOString(),
    entities: entityRows.map((entity) => ({ ...entity, truthStatus: BusinessContextTruthStatusSchema.parse(entity.truthStatus) })),
    blockingGapIds: gapRows.filter(isCriticalProjectGap).map((gap) => gap.id)
  };
}

@Injectable()
export class PostgresBusinessContextRepository implements BusinessContextRepository {
  constructor(@Inject(DATABASE) private readonly database: AxiomDatabase) {}

  async findCurrent(organizationId: string, projectId: string) {
    const [project] = await this.database.select({ id: projects.id, graphVersion: projects.graphVersion }).from(projects)
      .where(and(eq(projects.organizationId, organizationId), eq(projects.id, projectId))).limit(1);
    if (project === undefined) return null;
    if (project.graphVersion < 1) return { projectId: project.id, graphVersion: project.graphVersion, analyzedAt: null, entities: [], blockingGapIds: [] };
    return snapshotForGraph(this.database, organizationId, project.id, project.graphVersion);
  }

  async current(organizationId: string, projectId: string) {
    const [project] = await this.database.select({ id: projects.id, graphVersion: projects.graphVersion }).from(projects)
      .where(and(eq(projects.organizationId, organizationId), eq(projects.id, projectId))).limit(1);
    if (project === undefined) return null;
    return baselineFor(this.database, organizationId, project.id, project.graphVersion);
  }

  async generate(input: BusinessContextGenerationInput) {
    return this.database.transaction(async (transaction) => {
      const reservation = await claimPostgresIdempotency(transaction, {
        organizationId: input.context.organizationId,
        scope: 'BUSINESS_CONTEXT_GENERATE',
        key: input.idempotencyKey,
        requestHash: input.requestHash
      });
      if (reservation.kind === 'HASH_CONFLICT') throw new BusinessContextConflictError('Idempotency key was used for another Business Context generation');
      if (reservation.kind === 'REPLAY') return BusinessContextMutationResponseSchema.parse({ ...reservation.responsePayload, replayed: true });
      if (reservation.kind === 'IN_PROGRESS') throw new BusinessContextConflictError('Business Context generation with this idempotency key is still processing');

      const [project] = await transaction.select().from(projects).where(and(
        eq(projects.organizationId, input.context.organizationId),
        eq(projects.id, input.projectId)
      )).limit(1).for('update');
      if (project === undefined) throw new BusinessContextNotFoundError('Project was not found');
      if (project.rowVersion !== input.expectedRowVersion) throw new BusinessContextVersionConflictError('Project changed before Business Context generation');
      if (project.status === 'ARCHIVED' || project.status === 'SOURCES_READY' || project.graphVersion < 1 || project.graphVersion !== input.sourceGraphVersion) {
        throw new BusinessContextBlockedError('Business Context generation requires analysis of the exact current source set and active graph');
      }

      const snapshot = await snapshotForGraph(transaction, input.context.organizationId, input.projectId, input.sourceGraphVersion);
      if (snapshot.analyzedAt === null) throw new BusinessContextBlockedError('Analyze the current project sources before generating Business Context');
      const payload = compileBusinessContext({
        projectId: snapshot.projectId,
        graphVersion: snapshot.graphVersion,
        analyzedAt: snapshot.analyzedAt,
        entities: snapshot.entities,
        blockingGapIds: snapshot.blockingGapIds
      });
      if (payload.contentHash !== input.previewContentHash) throw new BusinessContextVersionConflictError('Business Context preview changed before generation');
      const [latest] = await transaction.select({ version: businessContextVersions.version }).from(businessContextVersions).where(and(
        eq(businessContextVersions.organizationId, input.context.organizationId),
        eq(businessContextVersions.projectId, input.projectId)
      )).orderBy(desc(businessContextVersions.version)).limit(1);
      const generatedAt = new Date().toISOString();
      const version = BusinessContextVersionSchema.parse({
        id: `BCV-${randomUUID()}`,
        projectId: input.projectId,
        version: (latest?.version ?? 0) + 1,
        sourceGraphVersion: input.sourceGraphVersion,
        contentHash: payload.contentHash,
        compilerVersion: payload.compilerVersion,
        payload,
        generatedByUserId: input.context.userId,
        generatedAt
      });
      await transaction.insert(businessContextVersions).values({
        id: version.id,
        organizationId: input.context.organizationId,
        projectId: input.projectId,
        graphVersion: input.sourceGraphVersion,
        version: version.version,
        contentHash: version.contentHash,
        compilerVersion: version.compilerVersion,
        payload: version.payload,
        generatedByUserId: input.context.userId,
        generatedAt
      });
      const [updated] = await transaction.update(projects).set({
        rowVersion: sql`${projects.rowVersion} + 1`,
        updatedAt: generatedAt
      }).where(and(
        eq(projects.organizationId, input.context.organizationId),
        eq(projects.id, input.projectId),
        eq(projects.rowVersion, input.expectedRowVersion)
      )).returning();
      if (updated === undefined) throw new BusinessContextVersionConflictError('Project changed before Business Context generation');
      const baseline = BusinessContextBaselineSchema.parse({ projectId: input.projectId, graphVersion: input.sourceGraphVersion, version, review: null });
      const response = BusinessContextMutationResponseSchema.parse({ project: projectResponse(updated), baseline, replayed: false });
      await transaction.insert(auditEvents).values({
        id: `AUDIT-${randomUUID()}`,
        organizationId: input.context.organizationId,
        actorUserId: input.context.userId,
        action: 'BUSINESS_CONTEXT_GENERATED',
        targetType: 'BusinessContextVersion',
        targetId: version.id,
        requestId: input.requestId,
        metadata: {
          projectId: input.projectId,
          graphVersion: input.sourceGraphVersion,
          version: version.version,
          contentHash: version.contentHash,
          compilerVersion: version.compilerVersion,
          sessionId: input.context.sessionId
        }
      });
      await completePostgresIdempotency(transaction, {
        recordId: reservation.recordId,
        responseStatus: 201,
        responsePayload: response,
        completedAt: generatedAt
      });
      return response;
    });
  }

  async resolveApplicability(input: ExperienceApplicabilityDecisionInput) {
    return this.database.transaction(async (transaction) => {
      const reservation = await claimPostgresIdempotency(transaction, {
        organizationId: input.context.organizationId,
        scope: 'EXPERIENCE_APPLICABILITY_DECIDE',
        key: input.idempotencyKey,
        requestHash: input.requestHash
      });
      if (reservation.kind === 'HASH_CONFLICT') throw new BusinessContextConflictError('Idempotency key was used for another experience applicability decision');
      if (reservation.kind === 'REPLAY') return ExperienceApplicabilityDecisionResponseSchema.parse({ ...reservation.responsePayload, replayed: true });
      if (reservation.kind === 'IN_PROGRESS') throw new BusinessContextConflictError('Experience applicability decision with this idempotency key is still processing');

      const [project] = await transaction.select().from(projects).where(and(
        eq(projects.organizationId, input.context.organizationId),
        eq(projects.id, input.projectId)
      )).limit(1).for('update');
      if (project === undefined) throw new BusinessContextNotFoundError('Project was not found');
      if (project.rowVersion !== input.expectedRowVersion) throw new BusinessContextVersionConflictError('Project changed before the experience applicability decision');
      if (project.status === 'ARCHIVED' || project.graphVersion < 1 || project.graphVersion !== input.sourceGraphVersion) {
        throw new BusinessContextBlockedError('Experience applicability requires the exact current active graph');
      }

      const [currentGraph] = await transaction.select().from(projectGraphs).where(and(
        eq(projectGraphs.organizationId, input.context.organizationId),
        eq(projectGraphs.projectId, input.projectId),
        eq(projectGraphs.graphVersion, input.sourceGraphVersion)
      )).limit(1);
      if (currentGraph === undefined) throw new BusinessContextBlockedError('Analyze the current project sources before deciding experience applicability');
      const gaps = await transaction.select().from(projectGaps).where(and(
        eq(projectGaps.organizationId, input.context.organizationId),
        eq(projectGaps.projectId, input.projectId),
        eq(projectGaps.graphVersion, input.sourceGraphVersion)
      ));
      const questions = await transaction.select().from(clarificationQuestions).where(and(
        eq(clarificationQuestions.organizationId, input.context.organizationId),
        eq(clarificationQuestions.projectId, input.projectId),
        eq(clarificationQuestions.graphVersion, input.sourceGraphVersion)
      ));
      const entities = await transaction.select().from(knowledgeEntities).where(and(
        eq(knowledgeEntities.organizationId, input.context.organizationId),
        eq(knowledgeEntities.projectId, input.projectId),
        eq(knowledgeEntities.graphVersion, input.sourceGraphVersion)
      )).orderBy(asc(knowledgeEntities.position));
      const currentPreview = compileBusinessContext({
        projectId: input.projectId,
        graphVersion: input.sourceGraphVersion,
        analyzedAt: new Date(currentGraph.analyzedAt).toISOString(),
        entities: entities.map((entity) => ({
          id: entity.id,
          category: entity.category,
          text: entity.text,
          truthStatus: BusinessContextTruthStatusSchema.parse(entity.truthStatus),
          sourceId: entity.sourceId
        })),
        blockingGapIds: gaps.filter(isCriticalProjectGap).map((gap) => gap.id)
      });
      if (currentPreview.contentHash !== input.previewContentHash) throw new BusinessContextVersionConflictError('Business Context preview changed before the experience applicability decision');
      if (currentPreview.applicability.status !== 'NEEDS_DECISION') throw new BusinessContextConflictError('Experience applicability is already explicit in the current graph');

      const decidedAt = new Date().toISOString();
      const nextGraphVersion = input.sourceGraphVersion + 1;
      const decisionEntityId = `DECISION-EXPERIENCE-APPLICABILITY-${input.projectId}`;
      const carriedEntities = entities
        .filter((entity) => entity.id !== decisionEntityId)
        .map((entity) => ({ ...entity, graphVersion: nextGraphVersion }));
      const decisionEntity = {
        id: decisionEntityId,
        organizationId: input.context.organizationId,
        projectId: input.projectId,
        graphVersion: nextGraphVersion,
        category: 'DECISION',
        text: input.decision === 'APPLICABLE'
          ? 'Human-confirmed decision: this scope requires a user interface.'
          : 'Human-confirmed decision: this scope is API-only with no user interface.',
        truthStatus: 'HUMAN_CONFIRMED',
        sourceId: null,
        clarificationQuestionId: null,
        quote: null,
        startOffset: null,
        endOffset: null,
        position: entities.reduce((maximum, entity) => Math.max(maximum, entity.position), -1) + 1
      };
      const nextGaps = gaps.map((gap) => ({ ...gap, graphVersion: nextGraphVersion }));
      const nextQuestions = questions.map((question) => ({ ...question, graphVersion: nextGraphVersion }));
      const readiness = calculateProjectReadiness({ entities: [...carriedEntities, decisionEntity], gaps: nextGaps, calculatedAt: decidedAt });
      const nextStatus = nextGaps.some(isCriticalProjectGap) ? 'NEEDS_CLARIFICATION' as const : 'ANALYZED' as const;

      await transaction.insert(projectGraphs).values({
        organizationId: input.context.organizationId,
        projectId: input.projectId,
        graphVersion: nextGraphVersion,
        summary: currentGraph.summary,
        readiness,
        analyzer: 'axiom-human-experience-applicability-v1',
        analyzedAt: decidedAt
      });
      if (nextGaps.length > 0) await transaction.insert(projectGaps).values(nextGaps);
      if (nextQuestions.length > 0) await transaction.insert(clarificationQuestions).values(nextQuestions);
      if (carriedEntities.length > 0) await transaction.insert(knowledgeEntities).values(carriedEntities);
      await transaction.insert(knowledgeEntities).values(decisionEntity);

      const decision = ExperienceApplicabilityDecisionSchema.parse({
        id: `EAD-${randomUUID()}`,
        projectId: input.projectId,
        previousGraphVersion: input.sourceGraphVersion,
        graphVersion: nextGraphVersion,
        decision: input.decision,
        rationale: input.rationale,
        sourcePreviewContentHash: input.previewContentHash,
        truthStatus: 'HUMAN_CONFIRMED',
        decidedByUserId: input.context.userId,
        decidedAt
      });
      await transaction.insert(experienceApplicabilityDecisions).values({
        id: decision.id,
        organizationId: input.context.organizationId,
        projectId: decision.projectId,
        previousGraphVersion: decision.previousGraphVersion,
        graphVersion: decision.graphVersion,
        decision: decision.decision,
        rationale: decision.rationale,
        sourcePreviewContentHash: decision.sourcePreviewContentHash,
        truthStatus: decision.truthStatus,
        decidedByUserId: decision.decidedByUserId,
        decidedAt: decision.decidedAt
      });

      const [updated] = await transaction.update(projects).set({
        graphVersion: nextGraphVersion,
        status: nextStatus,
        rowVersion: sql`${projects.rowVersion} + 1`,
        updatedAt: decidedAt
      }).where(and(
        eq(projects.organizationId, input.context.organizationId),
        eq(projects.id, input.projectId),
        eq(projects.rowVersion, input.expectedRowVersion)
      )).returning();
      if (updated === undefined) throw new BusinessContextVersionConflictError('Project changed before the experience applicability decision');

      const preview = compileBusinessContext({
        projectId: input.projectId,
        graphVersion: nextGraphVersion,
        analyzedAt: decidedAt,
        entities: [...carriedEntities, decisionEntity].map((entity) => ({
          id: entity.id,
          category: entity.category,
          text: entity.text,
          truthStatus: BusinessContextTruthStatusSchema.parse(entity.truthStatus),
          sourceId: entity.sourceId
        })),
        blockingGapIds: nextGaps.filter(isCriticalProjectGap).map((gap) => gap.id)
      });
      const response = ExperienceApplicabilityDecisionResponseSchema.parse({ project: projectResponse(updated), decision, preview, replayed: false });
      await transaction.insert(auditEvents).values({
        id: `AUDIT-${randomUUID()}`,
        organizationId: input.context.organizationId,
        actorUserId: input.context.userId,
        action: 'EXPERIENCE_APPLICABILITY_DECIDED',
        targetType: 'ExperienceApplicabilityDecision',
        targetId: decision.id,
        requestId: input.requestId,
        metadata: {
          projectId: input.projectId,
          previousGraphVersion: input.sourceGraphVersion,
          graphVersion: nextGraphVersion,
          previousProjectStatus: project.status,
          projectStatus: nextStatus,
          decision: input.decision,
          sourcePreviewContentHash: input.previewContentHash,
          rationaleHash: createHash('sha256').update(input.rationale, 'utf8').digest('hex'),
          sessionId: input.context.sessionId
        }
      });
      await completePostgresIdempotency(transaction, {
        recordId: reservation.recordId,
        responseStatus: 201,
        responsePayload: response,
        completedAt: decidedAt
      });
      return response;
    });
  }

  async review(input: BusinessContextReviewInput) {
    return this.database.transaction(async (transaction) => {
      const reservation = await claimPostgresIdempotency(transaction, {
        organizationId: input.context.organizationId,
        scope: 'BUSINESS_CONTEXT_REVIEW',
        key: input.idempotencyKey,
        requestHash: input.requestHash
      });
      if (reservation.kind === 'HASH_CONFLICT') throw new BusinessContextConflictError('Idempotency key was used for another Business Context review');
      if (reservation.kind === 'REPLAY') return BusinessContextMutationResponseSchema.parse({ ...reservation.responsePayload, replayed: true });
      if (reservation.kind === 'IN_PROGRESS') throw new BusinessContextConflictError('Business Context review with this idempotency key is still processing');

      const [project] = await transaction.select().from(projects).where(and(
        eq(projects.organizationId, input.context.organizationId),
        eq(projects.id, input.projectId)
      )).limit(1).for('update');
      if (project === undefined) throw new BusinessContextNotFoundError('Project was not found');
      if (project.rowVersion !== input.expectedRowVersion) throw new BusinessContextVersionConflictError('Project changed before Business Context review');
      if (project.status === 'ARCHIVED' || project.graphVersion !== input.sourceGraphVersion) throw new BusinessContextBlockedError('Business Context review requires the exact current active graph');
      const baseline = await baselineFor(transaction, input.context.organizationId, input.projectId, input.sourceGraphVersion);
      if (baseline.version === null) throw new BusinessContextBlockedError('Generate the exact current Business Context before review');
      if (baseline.review !== null) throw new BusinessContextConflictError('This exact Business Context version already has a review');
      if (baseline.version.id !== input.contextVersionId || baseline.version.contentHash !== input.contextContentHash) {
        throw new BusinessContextVersionConflictError('Business Context version changed before review');
      }
      if (input.decision === 'ACCEPT') {
        const payload = baseline.version.payload;
        if (payload.blockingGapIds.length > 0) throw new BusinessContextBlockedError(`Critical gaps remain open: ${payload.blockingGapIds.join(', ')}`);
        if (payload.unknowns.length > 0) throw new BusinessContextBlockedError(`Business Context unknowns remain unresolved: ${payload.unknowns.map((unknown) => unknown.code).join(', ')}`);
        if (payload.applicability.status === 'NEEDS_DECISION') throw new BusinessContextBlockedError('Experience applicability requires a human-confirmed graph decision before approval');
      }

      const reviewedAt = new Date().toISOString();
      const proposedGraphChanges = input.proposedGraphChanges.map((change) => ({ ...change, status: 'PROPOSED_GRAPH_MUTATION' as const }));
      const review = BusinessContextReviewSchema.parse({
        id: `BCREV-${randomUUID()}`,
        projectId: input.projectId,
        sourceGraphVersion: input.sourceGraphVersion,
        contextVersionId: baseline.version.id,
        contextContentHash: baseline.version.contentHash,
        decision: input.decision,
        feedbackCategory: input.feedbackCategory,
        comment: input.comment,
        proposedGraphChanges,
        truthStatus: input.decision === 'ACCEPT' ? 'HUMAN_APPROVED' : 'HUMAN_REVIEWED',
        reviewedByUserId: input.context.userId,
        reviewedAt
      });
      await transaction.insert(businessContextReviews).values({
        id: review.id,
        organizationId: input.context.organizationId,
        projectId: input.projectId,
        graphVersion: input.sourceGraphVersion,
        contextVersionId: review.contextVersionId,
        contextContentHash: review.contextContentHash,
        decision: review.decision,
        feedbackCategory: review.feedbackCategory,
        comment: review.comment,
        proposedGraphChanges: review.proposedGraphChanges,
        truthStatus: review.truthStatus,
        reviewedByUserId: input.context.userId,
        reviewedAt
      });
      const [updated] = await transaction.update(projects).set({
        rowVersion: sql`${projects.rowVersion} + 1`,
        updatedAt: reviewedAt
      }).where(and(
        eq(projects.organizationId, input.context.organizationId),
        eq(projects.id, input.projectId),
        eq(projects.rowVersion, input.expectedRowVersion)
      )).returning();
      if (updated === undefined) throw new BusinessContextVersionConflictError('Project changed before Business Context review');
      const reviewedBaseline = BusinessContextBaselineSchema.parse({ ...baseline, review });
      const response = BusinessContextMutationResponseSchema.parse({ project: projectResponse(updated), baseline: reviewedBaseline, replayed: false });
      await transaction.insert(auditEvents).values({
        id: `AUDIT-${randomUUID()}`,
        organizationId: input.context.organizationId,
        actorUserId: input.context.userId,
        action: input.decision === 'ACCEPT' ? 'BUSINESS_CONTEXT_APPROVED' : 'BUSINESS_CONTEXT_REVIEWED',
        targetType: 'BusinessContextReview',
        targetId: review.id,
        requestId: input.requestId,
        metadata: {
          projectId: input.projectId,
          graphVersion: input.sourceGraphVersion,
          contextVersionId: review.contextVersionId,
          contextContentHash: review.contextContentHash,
          decision: review.decision,
          feedbackCategory: review.feedbackCategory,
          commentHash: createHash('sha256').update(review.comment, 'utf8').digest('hex'),
          proposedGraphChangesHash: createHash('sha256').update(JSON.stringify(review.proposedGraphChanges), 'utf8').digest('hex'),
          proposedGraphChangeCount: review.proposedGraphChanges.length,
          sessionId: input.context.sessionId
        }
      });
      await completePostgresIdempotency(transaction, {
        recordId: reservation.recordId,
        responseStatus: 201,
        responsePayload: response,
        completedAt: reviewedAt
      });
      return response;
    });
  }
}
