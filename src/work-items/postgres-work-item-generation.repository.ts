import { createHash, randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';

import type { AxiomDatabase } from '../database/client';
import { DATABASE } from '../database/database.module';
import { claimPostgresIdempotency, completePostgresIdempotency } from '../database/idempotency/postgres-idempotency';
import { currentArtifactApproval } from '../artifacts/postgres-artifact-approval.query';
import { currentArchitectureDecision } from '../architecture/postgres-architecture-decision.query';
import {
  agentRuns,
  auditEvents,
  clarificationQuestions,
  knowledgeEntities,
  modelCalls,
  projectGaps,
  projects,
  workItemGenerationItems,
  workItemGenerations,
  workItemReviewItems,
  workItemReviews,
  workItems,
  workItemVersions
} from '../database/schema';
import { businessContextDownstreamGate } from '../experience/postgres-business-context-gate.query';
import { WorkItemGenerationPreviewSchema, type WorkItemGenerationPreview } from './work-item-generation.schema';
import { WorkItemGenerationBlockerSchema } from './work-item-generation-blocker.schema';
import { isCriticalGenerationGap } from './work-item-generation-blocker.policy';
import {
  WorkItemGenerationBlockedError,
  WorkItemGenerationConflictError,
  type GenerationContext,
  type PersistGenerationInput,
  type WorkItemGenerationRepository
} from './work-item-generation.repository';
import { WorkItemSchema, type EvaluationSourceEntity, type WorkItem } from './work-item.schema';

const allowedGenerationStatuses = ['HLD_READY', 'PUBLISHED', 'BACKLOG_READY'];

function sourceKind(category: string): EvaluationSourceEntity['kind'] | null {
  if (category === 'REQUIREMENT' || category === 'NFR' || category === 'DECISION' || category === 'CONSTRAINT' || category === 'RISK') return category;
  return null;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

@Injectable()
export class PostgresWorkItemGenerationRepository implements WorkItemGenerationRepository {
  constructor(@Inject(DATABASE) private readonly database: AxiomDatabase) {}

  async loadContext(organizationId: string, projectId: string): Promise<GenerationContext | null> {
    const [project] = await this.database.select({ id: projects.id, name: projects.name, status: projects.status, graphVersion: projects.graphVersion })
      .from(projects).where(and(eq(projects.organizationId, organizationId), eq(projects.id, projectId))).limit(1);
    if (project === undefined) return null;
    const [approval, decision, businessContextGate, gaps, entities] = await Promise.all([
      currentArtifactApproval(this.database, organizationId, projectId, project.graphVersion).then((result) => result.approval),
      currentArchitectureDecision(this.database, organizationId, projectId, project.graphVersion).then((result) => result.decision),
      businessContextDownstreamGate(this.database, organizationId, projectId, project.graphVersion),
      this.database.select({
        gapId: projectGaps.id,
        type: projectGaps.type,
        category: projectGaps.category,
        title: projectGaps.title,
        description: projectGaps.description,
        severity: projectGaps.severity,
        status: projectGaps.status,
        truthStatus: projectGaps.truthStatus,
        clarificationId: clarificationQuestions.id,
        question: clarificationQuestions.question,
        whyItMatters: clarificationQuestions.whyItMatters,
        affectedEntityIds: clarificationQuestions.affectedEntityIds,
        clarificationPosition: clarificationQuestions.position
      }).from(projectGaps).leftJoin(clarificationQuestions, and(
        eq(clarificationQuestions.organizationId, projectGaps.organizationId),
        eq(clarificationQuestions.projectId, projectGaps.projectId),
        eq(clarificationQuestions.graphVersion, projectGaps.graphVersion),
        eq(clarificationQuestions.gapId, projectGaps.id),
        eq(clarificationQuestions.status, 'OPEN')
      )).where(and(
        eq(projectGaps.organizationId, organizationId),
        eq(projectGaps.projectId, projectId),
        eq(projectGaps.graphVersion, project.graphVersion)
      )).orderBy(asc(projectGaps.id), asc(clarificationQuestions.position)),
      this.database.select({ id: knowledgeEntities.id, category: knowledgeEntities.category, text: knowledgeEntities.text, truthStatus: knowledgeEntities.truthStatus }).from(knowledgeEntities).where(and(eq(knowledgeEntities.organizationId, organizationId), eq(knowledgeEntities.projectId, projectId), eq(knowledgeEntities.graphVersion, project.graphVersion), inArray(knowledgeEntities.truthStatus, ['SOURCE_GROUNDED', 'HUMAN_CONFIRMED']))).orderBy(knowledgeEntities.position)
    ]);
    return {
      projectId: project.id,
      projectName: project.name,
      projectStatus: project.status,
      graphVersion: project.graphVersion,
      documentApprovalId: approval?.id ?? null,
      arbDecisionId: decision?.id ?? null,
      businessContextBlockingReason: businessContextGate.allowed ? null : businessContextGate.reason,
      blockers: [...new Map(gaps.filter(isCriticalGenerationGap).map((gap) => [gap.gapId, gap])).values()]
        .map((gap) => WorkItemGenerationBlockerSchema.parse({
          gapId: gap.gapId,
          type: gap.type,
          category: gap.category,
          title: gap.title,
          description: gap.description,
          severity: gap.severity,
          truthStatus: gap.truthStatus,
          clarification: gap.clarificationId === null ? null : {
            id: gap.clarificationId,
            question: gap.question,
            whyItMatters: gap.whyItMatters,
            affectedEntityIds: gap.affectedEntityIds
          }
        })),
      entities: entities.flatMap((entity) => {
        const kind = sourceKind(entity.category);
        if (kind === null || (entity.truthStatus !== 'SOURCE_GROUNDED' && entity.truthStatus !== 'HUMAN_CONFIRMED')) return [];
        return [{ id: entity.id, kind, truthStatus: entity.truthStatus, text: entity.text }];
      })
    };
  }

  async persist(input: PersistGenerationInput): Promise<WorkItemGenerationPreview> {
    return this.database.transaction(async (transaction) => {
      const reservation = await claimPostgresIdempotency(transaction, {
        organizationId: input.context.organizationId,
        scope: 'WORK_ITEM_GENERATE',
        key: input.idempotencyKey,
        requestHash: input.requestHash
      });
      if (reservation.kind === 'HASH_CONFLICT') throw new WorkItemGenerationConflictError('Idempotency key was used for another generation request');
      if (reservation.kind === 'REPLAY') {
        const payload = reservation.responsePayload;
        return WorkItemGenerationPreviewSchema.parse({
          ...payload,
          generationContentHash: payload.generationContentHash ?? payload.contentHash,
          review: payload.review ?? null,
          replayed: true
        });
      }
      if (reservation.kind === 'IN_PROGRESS') throw new WorkItemGenerationConflictError('Generation with this idempotency key is still processing');

      const [project] = await transaction.select({ status: projects.status, graphVersion: projects.graphVersion }).from(projects)
        .where(and(eq(projects.organizationId, input.context.organizationId), eq(projects.id, input.batch.projectId))).limit(1).for('update');
      if (project === undefined) throw new WorkItemGenerationBlockedError(['Project was not found in this organization.']);
      const reasons: string[] = [];
      if (!allowedGenerationStatuses.includes(project.status)) reasons.push(`Project status ${project.status} is not ready for backlog generation.`);
      if (project.graphVersion !== input.batch.sourceGraphVersion) reasons.push('The canonical graph changed before generation could be persisted.');
      const approval = (await currentArtifactApproval(transaction, input.context.organizationId, input.batch.projectId, input.batch.sourceGraphVersion)).approval;
      const decision = (await currentArchitectureDecision(transaction, input.context.organizationId, input.batch.projectId, input.batch.sourceGraphVersion)).decision;
      const businessContextGate = await businessContextDownstreamGate(transaction, input.context.organizationId, input.batch.projectId, input.batch.sourceGraphVersion);
      const gapStates = await transaction.select({
        id: projectGaps.id,
        type: projectGaps.type,
        severity: projectGaps.severity,
        status: projectGaps.status,
        truthStatus: projectGaps.truthStatus
      }).from(projectGaps).where(and(
        eq(projectGaps.organizationId, input.context.organizationId),
        eq(projectGaps.projectId, input.batch.projectId),
        eq(projectGaps.graphVersion, input.batch.sourceGraphVersion)
      ));
      const blockers = gapStates.filter(isCriticalGenerationGap);
      if (approval === null) reasons.push('The current graph has no exact current-artifact approval.');
      if (decision === null) reasons.push('The current graph has no exact latest-generation architecture decision.');
      if (!businessContextGate.allowed) reasons.push(businessContextGate.reason!);
      if (blockers.length > 0) reasons.push(`Blocking gaps remain open: ${blockers.map((gap) => gap.id).join(', ')}.`);
      if (reasons.length > 0) throw new WorkItemGenerationBlockedError(reasons);

      const versionedItems: WorkItem[] = [];
      for (const item of input.batch.workItems) {
        const [existing] = await transaction.select({ currentVersion: workItems.currentVersion }).from(workItems)
          .where(and(eq(workItems.organizationId, input.context.organizationId), eq(workItems.projectId, input.batch.projectId), eq(workItems.id, item.id))).limit(1).for('update');
        versionedItems.push(WorkItemSchema.parse({ ...item, version: (existing?.currentVersion ?? 0) + 1, reviewStatus: 'DRAFT' }));
      }
      const contentHash = sha256(versionedItems);
      const generatedAt = new Date().toISOString();
      await transaction.update(workItemGenerations).set({ status: 'SUPERSEDED' }).where(and(
        eq(workItemGenerations.organizationId, input.context.organizationId),
        eq(workItemGenerations.projectId, input.batch.projectId),
        eq(workItemGenerations.status, 'DRAFT')
      ));
      await transaction.insert(workItemGenerations).values({
        id: input.id, organizationId: input.context.organizationId, projectId: input.batch.projectId,
        sourceGraphVersion: input.batch.sourceGraphVersion, status: 'DRAFT', contentHash,
        schemaVersion: input.batch.schemaVersion, evaluatorVersion: input.qualityReport.evaluatorVersion,
        promptVersion: input.batch.promptVersion, workflowVersion: input.batch.workflowVersion,
        agentRunId: input.provenance.runId,
        qualityReport: input.qualityReport, createdByUserId: input.context.userId, createdAt: generatedAt
      });
      for (const [position, item] of versionedItems.entries()) {
        const [existing] = await transaction.select({ id: workItems.id }).from(workItems).where(eq(workItems.id, item.id)).limit(1);
        if (existing === undefined) {
          await transaction.insert(workItems).values({ id: item.id, organizationId: input.context.organizationId, projectId: input.batch.projectId, type: item.type, parentId: item.parentId, currentVersion: item.version, reviewStatus: 'DRAFT', sourceGraphVersion: input.batch.sourceGraphVersion });
        } else {
          await transaction.update(workItems).set({ type: item.type, parentId: item.parentId, currentVersion: item.version, reviewStatus: 'DRAFT', sourceGraphVersion: input.batch.sourceGraphVersion, rowVersion: sql`${workItems.rowVersion} + 1`, updatedAt: generatedAt }).where(and(eq(workItems.organizationId, input.context.organizationId), eq(workItems.projectId, input.batch.projectId), eq(workItems.id, item.id)));
        }
        await transaction.insert(workItemVersions).values({ organizationId: input.context.organizationId, projectId: input.batch.projectId, workItemId: item.id, version: item.version, generationId: input.id, payload: item, contentHash: sha256(item), createdByUserId: input.context.userId, createdAt: generatedAt });
        await transaction.insert(workItemGenerationItems).values({ generationId: input.id, workItemId: item.id, workItemVersion: item.version, position });
      }
      if (project.status !== 'BACKLOG_READY') {
        await transaction.update(projects).set({ status: 'BACKLOG_READY', rowVersion: sql`${projects.rowVersion} + 1`, updatedAt: generatedAt }).where(and(eq(projects.organizationId, input.context.organizationId), eq(projects.id, input.batch.projectId)));
      }
      const preview = WorkItemGenerationPreviewSchema.parse({
        id: input.id, projectId: input.batch.projectId, sourceGraphVersion: input.batch.sourceGraphVersion,
        status: 'DRAFT', contentHash, generationContentHash: contentHash, schemaVersion: input.batch.schemaVersion,
        evaluatorVersion: input.qualityReport.evaluatorVersion, promptVersion: input.batch.promptVersion,
        workflowVersion: input.batch.workflowVersion, qualityReport: input.qualityReport,
        provenance: input.provenance,
        workItems: versionedItems, generatedAt, review: null, replayed: false
      });
      await transaction.insert(auditEvents).values({
        id: `AUDIT-${randomUUID()}`, organizationId: input.context.organizationId, actorUserId: input.context.userId,
        action: 'WORK_ITEM_DRAFT_GENERATED', targetType: 'WorkItemGeneration', targetId: input.id, requestId: input.requestId,
        metadata: { projectId: input.batch.projectId, sourceGraphVersion: input.batch.sourceGraphVersion, contentHash, workItemCount: versionedItems.length, evaluatorVersion: input.qualityReport.evaluatorVersion, sessionId: input.context.sessionId }
      });
      await completePostgresIdempotency(transaction, { recordId: reservation.recordId, responseStatus: 201, responsePayload: preview, completedAt: generatedAt });
      return preview;
    });
  }

  async latest(organizationId: string, projectId: string): Promise<WorkItemGenerationPreview | null> {
    const [generation] = await this.database.select().from(workItemGenerations)
      .where(and(eq(workItemGenerations.organizationId, organizationId), eq(workItemGenerations.projectId, projectId)))
      .orderBy(desc(workItemGenerations.createdAt), desc(workItemGenerations.id)).limit(1);
    if (generation === undefined) return null;
    const [run] = generation.agentRunId === null ? [] : await this.database.select().from(agentRuns).where(and(
      eq(agentRuns.organizationId, organizationId),
      eq(agentRuns.id, generation.agentRunId)
    )).limit(1);
    const [call] = run?.finalModelCallId === null || run?.finalModelCallId === undefined ? [] : await this.database.select().from(modelCalls).where(and(
      eq(modelCalls.organizationId, organizationId),
      eq(modelCalls.id, run.finalModelCallId)
    )).limit(1);
    const [review] = await this.database.select().from(workItemReviews).where(eq(workItemReviews.generationId, generation.id)).limit(1);
    const rows = review === undefined
      ? await this.database.select({ payload: workItemVersions.payload }).from(workItemGenerationItems)
        .innerJoin(workItemVersions, and(eq(workItemVersions.workItemId, workItemGenerationItems.workItemId), eq(workItemVersions.version, workItemGenerationItems.workItemVersion)))
        .where(eq(workItemGenerationItems.generationId, generation.id)).orderBy(workItemGenerationItems.position)
      : await this.database.select({ payload: workItemVersions.payload }).from(workItemReviewItems)
        .innerJoin(workItemVersions, and(eq(workItemVersions.workItemId, workItemReviewItems.workItemId), eq(workItemVersions.version, workItemReviewItems.workItemVersion)))
        .where(eq(workItemReviewItems.reviewId, review.id)).orderBy(workItemReviewItems.position);
    return WorkItemGenerationPreviewSchema.parse({
      id: generation.id, projectId: generation.projectId, sourceGraphVersion: generation.sourceGraphVersion,
      status: generation.status, contentHash: review?.reviewedContentHash ?? generation.contentHash,
      generationContentHash: generation.contentHash, schemaVersion: generation.schemaVersion,
      evaluatorVersion: generation.evaluatorVersion, promptVersion: generation.promptVersion,
      workflowVersion: generation.workflowVersion, qualityReport: review?.qualityReport ?? generation.qualityReport,
      provenance: run === undefined || call === undefined || run.completedAt === null || call.usage === null ? null : {
        runId: run.id,
        modelCallId: call.id,
        tier: run.tier,
        provider: call.provider,
        modelDefinitionId: run.modelDefinitionId,
        immutableModelId: call.immutableModelId,
        promptVersion: run.promptVersion,
        workflowVersion: run.workflowVersion,
        policyId: run.policyId,
        policyVersion: run.policyVersion,
        budget: run.budgetStatus === 'NOT_APPLICABLE'
          ? { status: 'NOT_APPLICABLE', reason: 'NON_BILLABLE_LOCAL_FIXTURE' }
          : { status: 'RESERVED', reservationId: run.budgetReservationId! },
        usage: call.usage,
        attemptCount: call.attempt,
        fallbackUsed: false,
        latencyMs: call.latencyMs,
        completedAt: new Date(run.completedAt).toISOString()
      },
      workItems: rows.map((row) => row.payload), generatedAt: new Date(generation.createdAt).toISOString(),
      review: review === undefined ? null : {
        id: review.id,
        generationId: review.generationId,
        decision: review.decision,
        reasonCategory: review.reasonCategory,
        comment: review.comment,
        generationContentHash: review.generationContentHash,
        reviewedContentHash: review.reviewedContentHash,
        reviewedByUserId: review.reviewedByUserId,
        reviewedAt: new Date(review.reviewedAt).toISOString()
      },
      replayed: false
    });
  }
}
