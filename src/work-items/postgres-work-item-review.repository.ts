import { createHash, randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';

import type { AxiomDatabase } from '../database/client';
import { DATABASE } from '../database/database.module';
import { currentArtifactApproval } from '../artifacts/postgres-artifact-approval.query';
import { currentArchitectureDecision } from '../architecture/postgres-architecture-decision.query';
import {
  agentRuns,
  auditEvents,
  idempotencyRecords,
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
import { isCriticalGenerationGap } from './work-item-generation-blocker.policy';
import {
  WorkItemReviewBlockedError,
  WorkItemReviewConflictError,
  type PersistWorkItemReviewInput,
  type WorkItemReviewContext,
  type WorkItemReviewRepository
} from './work-item-review.repository';
import { WorkItemSchema, type EvaluationSourceEntity } from './work-item.schema';

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

function sourceKind(category: string): EvaluationSourceEntity['kind'] | null {
  if (category === 'REQUIREMENT' || category === 'NFR' || category === 'DECISION' || category === 'CONSTRAINT' || category === 'RISK') return category;
  return null;
}

@Injectable()
export class PostgresWorkItemReviewRepository implements WorkItemReviewRepository {
  constructor(@Inject(DATABASE) private readonly database: AxiomDatabase) {}

  async loadContext(organizationId: string, projectId: string, generationId: string): Promise<WorkItemReviewContext | null> {
    const [generation] = await this.database.select().from(workItemGenerations).where(and(
      eq(workItemGenerations.organizationId, organizationId),
      eq(workItemGenerations.projectId, projectId),
      eq(workItemGenerations.id, generationId)
    )).limit(1);
    if (generation === undefined) return null;
    const [run] = generation.agentRunId === null ? [] : await this.database.select().from(agentRuns).where(and(
      eq(agentRuns.organizationId, organizationId),
      eq(agentRuns.id, generation.agentRunId)
    )).limit(1);
    const [call] = run?.finalModelCallId === null || run?.finalModelCallId === undefined ? [] : await this.database.select().from(modelCalls).where(and(
      eq(modelCalls.organizationId, organizationId),
      eq(modelCalls.id, run.finalModelCallId)
    )).limit(1);
    const [entities, rows] = await Promise.all([
      this.database.select({ id: knowledgeEntities.id, category: knowledgeEntities.category, truthStatus: knowledgeEntities.truthStatus, text: knowledgeEntities.text }).from(knowledgeEntities).where(and(eq(knowledgeEntities.organizationId, organizationId), eq(knowledgeEntities.projectId, projectId), eq(knowledgeEntities.graphVersion, generation.sourceGraphVersion), inArray(knowledgeEntities.truthStatus, ['SOURCE_GROUNDED', 'HUMAN_CONFIRMED']))).orderBy(knowledgeEntities.position),
      this.database.select({ payload: workItemVersions.payload }).from(workItemGenerationItems)
        .innerJoin(workItemVersions, and(eq(workItemVersions.workItemId, workItemGenerationItems.workItemId), eq(workItemVersions.version, workItemGenerationItems.workItemVersion)))
        .where(eq(workItemGenerationItems.generationId, generationId)).orderBy(workItemGenerationItems.position)
    ]);
    if (rows.length === 0) return null;
    return {
      generationId: generation.id,
      projectId: generation.projectId,
      sourceGraphVersion: generation.sourceGraphVersion,
      generationContentHash: generation.contentHash,
      schemaVersion: generation.schemaVersion,
      evaluatorVersion: generation.evaluatorVersion,
      promptVersion: generation.promptVersion,
      workflowVersion: generation.workflowVersion,
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
      generatedAt: new Date(generation.createdAt).toISOString(),
      entities: entities.flatMap((entity) => {
        const kind = sourceKind(entity.category);
        if (kind === null || (entity.truthStatus !== 'SOURCE_GROUNDED' && entity.truthStatus !== 'HUMAN_CONFIRMED')) return [];
        return [{ id: entity.id, kind, truthStatus: entity.truthStatus, text: entity.text }];
      }),
      workItems: rows.map((row) => WorkItemSchema.parse(row.payload))
    };
  }

  async persist(input: PersistWorkItemReviewInput): Promise<WorkItemGenerationPreview> {
    return this.database.transaction(async (transaction) => {
      const reviewedAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
      const [reservation] = await transaction.insert(idempotencyRecords).values({
        id: `IDEMP-${randomUUID()}`,
        organizationId: input.context.organizationId,
        scope: 'WORK_ITEM_REVIEW',
        key: input.idempotencyKey,
        requestHash: input.requestHash,
        expiresAt
      }).onConflictDoNothing().returning({ id: idempotencyRecords.id });
      if (reservation === undefined) {
        const [existing] = await transaction.select().from(idempotencyRecords).where(and(
          eq(idempotencyRecords.organizationId, input.context.organizationId),
          eq(idempotencyRecords.scope, 'WORK_ITEM_REVIEW'),
          eq(idempotencyRecords.key, input.idempotencyKey)
        )).limit(1).for('update');
        if (existing === undefined || existing.requestHash !== input.requestHash) throw new WorkItemReviewConflictError('Idempotency key was used for another review request');
        if (existing.status === 'COMPLETED' && existing.responsePayload !== null) return WorkItemGenerationPreviewSchema.parse({ ...existing.responsePayload, replayed: true });
        throw new WorkItemReviewConflictError('Review with this idempotency key is still processing');
      }

      const [project] = await transaction.select({ graphVersion: projects.graphVersion }).from(projects).where(and(
        eq(projects.organizationId, input.context.organizationId),
        eq(projects.id, input.reviewContext.projectId)
      )).limit(1).for('update');
      const [generation] = await transaction.select().from(workItemGenerations).where(and(
        eq(workItemGenerations.organizationId, input.context.organizationId),
        eq(workItemGenerations.projectId, input.reviewContext.projectId),
        eq(workItemGenerations.id, input.reviewContext.generationId)
      )).limit(1).for('update');
      if (project === undefined || generation === undefined) throw new WorkItemReviewBlockedError(['The reviewed generation was not found in this organization.']);
      const [latest] = await transaction.select({ id: workItemGenerations.id }).from(workItemGenerations).where(and(
        eq(workItemGenerations.organizationId, input.context.organizationId),
        eq(workItemGenerations.projectId, input.reviewContext.projectId)
      )).orderBy(desc(workItemGenerations.createdAt), desc(workItemGenerations.id)).limit(1);
      const reasons: string[] = [];
      if (generation.status !== 'DRAFT') reasons.push(`Generation ${generation.id} is already ${generation.status}.`);
      if (latest?.id !== generation.id) reasons.push('Only the latest generation can be reviewed.');
      if (generation.contentHash !== input.reviewContext.generationContentHash) reasons.push('The generated snapshot changed before review.');
      const accepting = input.request.decision !== 'REJECT';
      if (accepting) {
        if (project.graphVersion !== generation.sourceGraphVersion) reasons.push('The canonical graph changed after this backlog was generated.');
        const approval = (await currentArtifactApproval(transaction, input.context.organizationId, generation.projectId, generation.sourceGraphVersion)).approval;
        const decision = (await currentArchitectureDecision(transaction, input.context.organizationId, generation.projectId, generation.sourceGraphVersion)).decision;
        const businessContextGate = await businessContextDownstreamGate(transaction, input.context.organizationId, generation.projectId, generation.sourceGraphVersion);
        const gapStates = await transaction.select({
          id: projectGaps.id,
          type: projectGaps.type,
          severity: projectGaps.severity,
          status: projectGaps.status,
          truthStatus: projectGaps.truthStatus
        }).from(projectGaps).where(and(
          eq(projectGaps.organizationId, input.context.organizationId),
          eq(projectGaps.projectId, generation.projectId),
          eq(projectGaps.graphVersion, generation.sourceGraphVersion)
        ));
        const blockers = gapStates.filter(isCriticalGenerationGap);
        if (approval === null) reasons.push('The exact source artifact approval is no longer valid.');
        if (decision === null) reasons.push('The exact latest-generation architecture approval is no longer valid.');
        if (!businessContextGate.allowed) reasons.push(businessContextGate.reason!);
        if (blockers.length > 0) reasons.push(`Blocking gaps remain open: ${blockers.map((gap) => gap.id).join(', ')}.`);
      }
      if (reasons.length > 0) throw new WorkItemReviewBlockedError(reasons);

      const originalRows = await transaction.select({ workItemId: workItemGenerationItems.workItemId, version: workItemGenerationItems.workItemVersion }).from(workItemGenerationItems)
        .where(eq(workItemGenerationItems.generationId, generation.id)).orderBy(workItemGenerationItems.position).for('update');
      if (originalRows.length !== input.reviewedWorkItems.length) throw new WorkItemReviewConflictError('The reviewed work-item set does not match the generated snapshot');
      const originalVersions = new Map(originalRows.map((row) => [row.workItemId, row.version]));
      const editedIds = new Set(input.editedWorkItemIds);
      for (const item of input.reviewedWorkItems) {
        const originalVersion = originalVersions.get(item.id);
        if (originalVersion === undefined) throw new WorkItemReviewConflictError(`Work item ${item.id} is not part of this generation`);
        const expectedVersion = editedIds.has(item.id) ? originalVersion + 1 : originalVersion;
        if (item.version !== expectedVersion) throw new WorkItemReviewConflictError(`Work item ${item.id} has a stale review version`);
      }

      const reviewedContentHash = sha256(input.reviewedWorkItems);
      const aggregateStatus = accepting ? 'APPROVED' : 'REJECTED';
      await transaction.insert(workItemReviews).values({
        id: input.id,
        organizationId: input.context.organizationId,
        projectId: generation.projectId,
        generationId: generation.id,
        decision: input.request.decision,
        reasonCategory: input.request.reasonCategory,
        comment: input.request.comment,
        generationContentHash: generation.contentHash,
        reviewedContentHash,
        qualityReport: input.qualityReport,
        reviewedByUserId: input.context.userId,
        reviewedAt
      });

      for (const [position, item] of input.reviewedWorkItems.entries()) {
        const originalVersion = originalVersions.get(item.id)!;
        if (editedIds.has(item.id)) {
          const [lockedItem] = await transaction.select({ currentVersion: workItems.currentVersion }).from(workItems).where(and(
            eq(workItems.organizationId, input.context.organizationId),
            eq(workItems.projectId, generation.projectId),
            eq(workItems.id, item.id)
          )).limit(1).for('update');
          if (lockedItem?.currentVersion !== originalVersion) throw new WorkItemReviewConflictError(`Work item ${item.id} changed before review`);
          await transaction.insert(workItemVersions).values({
            organizationId: input.context.organizationId,
            projectId: generation.projectId,
            workItemId: item.id,
            version: item.version,
            generationId: generation.id,
            payload: item,
            contentHash: sha256(item),
            createdByUserId: input.context.userId,
            createdAt: reviewedAt
          });
        }
        const updated = await transaction.update(workItems).set({
          currentVersion: item.version,
          reviewStatus: aggregateStatus,
          rowVersion: sql`${workItems.rowVersion} + 1`,
          updatedAt: reviewedAt
        }).where(and(
          eq(workItems.organizationId, input.context.organizationId),
          eq(workItems.projectId, generation.projectId),
          eq(workItems.id, item.id),
          eq(workItems.currentVersion, originalVersion)
        )).returning({ id: workItems.id });
        if (updated.length !== 1) throw new WorkItemReviewConflictError(`Work item ${item.id} changed before review`);
        await transaction.insert(workItemReviewItems).values({ reviewId: input.id, workItemId: item.id, workItemVersion: item.version, position });
      }

      await transaction.update(workItemGenerations).set({ status: accepting ? 'APPROVED' : 'REJECTED' }).where(eq(workItemGenerations.id, generation.id));
      const review = {
        id: input.id,
        generationId: generation.id,
        decision: input.request.decision,
        reasonCategory: input.request.reasonCategory,
        comment: input.request.comment,
        generationContentHash: generation.contentHash,
        reviewedContentHash,
        reviewedByUserId: input.context.userId,
        reviewedAt
      };
      const preview = WorkItemGenerationPreviewSchema.parse({
        id: generation.id,
        projectId: generation.projectId,
        sourceGraphVersion: generation.sourceGraphVersion,
        status: accepting ? 'APPROVED' : 'REJECTED',
        contentHash: reviewedContentHash,
        generationContentHash: generation.contentHash,
        schemaVersion: generation.schemaVersion,
        evaluatorVersion: generation.evaluatorVersion,
        promptVersion: generation.promptVersion,
        workflowVersion: generation.workflowVersion,
        provenance: input.reviewContext.provenance,
        qualityReport: input.qualityReport,
        workItems: input.reviewedWorkItems,
        generatedAt: new Date(generation.createdAt).toISOString(),
        review,
        replayed: false
      });
      await transaction.insert(auditEvents).values({
        id: `AUDIT-${randomUUID()}`,
        organizationId: input.context.organizationId,
        actorUserId: input.context.userId,
        action: input.request.decision === 'REJECT' ? 'WORK_ITEM_GENERATION_REJECTED' : input.request.decision === 'ACCEPT_WITH_EDITS' ? 'WORK_ITEM_GENERATION_ACCEPTED_WITH_EDITS' : 'WORK_ITEM_GENERATION_ACCEPTED',
        targetType: 'WorkItemGeneration',
        targetId: generation.id,
        requestId: input.requestId,
        metadata: {
          projectId: generation.projectId,
          generationContentHash: generation.contentHash,
          reviewedContentHash,
          reasonCategory: input.request.reasonCategory,
          editedWorkItemCount: input.editedWorkItemIds.length,
          sessionId: input.context.sessionId
        }
      });
      await transaction.update(idempotencyRecords).set({ status: 'COMPLETED', responseStatus: 201, responsePayload: preview, updatedAt: reviewedAt }).where(eq(idempotencyRecords.id, reservation.id));
      return preview;
    });
  }
}
