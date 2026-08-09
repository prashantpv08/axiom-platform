import { createHash, randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray } from 'drizzle-orm';

import { currentArtifactApproval } from '../artifacts/postgres-artifact-approval.query';
import { currentArchitectureDecision } from '../architecture/postgres-architecture-decision.query';
import type { AxiomDatabase } from '../database/client';
import { DATABASE } from '../database/database.module';
import {
  agentRuns,
  auditEvents,
  engineeringPlanGenerations,
  idempotencyRecords,
  knowledgeEntities,
  modelCalls,
  projectGaps,
  projects
} from '../database/schema';
import { businessContextDownstreamGate } from '../experience/postgres-business-context-gate.query';
import { isCriticalProjectGap } from '../projects/project-gap.policy';
import {
  EngineeringPlanBlockedError,
  EngineeringPlanConflictError,
  type EngineeringPlanGenerationContext,
  type EngineeringPlanRepository,
  type PersistEngineeringPlanInput
} from './engineering-plan.repository';
import { EngineeringPlanPreviewSchema, EngineeringPlanSchema, type EngineeringPlanPreview } from './engineering-plan.schema';
import { engineeringReferencesFor, type EngineeringReferenceId } from './engineering-reference.catalog';

const allowedGenerationStatuses = ['HLD_READY', 'BACKLOG_READY', 'PUBLISHED'];

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

@Injectable()
export class PostgresEngineeringPlanRepository implements EngineeringPlanRepository {
  constructor(@Inject(DATABASE) private readonly database: AxiomDatabase) {}

  async loadContext(organizationId: string, projectId: string): Promise<EngineeringPlanGenerationContext | null> {
    const [project] = await this.database.select({ id: projects.id, name: projects.name, status: projects.status, graphVersion: projects.graphVersion })
      .from(projects).where(and(eq(projects.organizationId, organizationId), eq(projects.id, projectId))).limit(1);
    if (project === undefined) return null;
    const [approvalResult, architecture, businessContextGate, entities, gaps] = await Promise.all([
      currentArtifactApproval(this.database, organizationId, projectId, project.graphVersion),
      currentArchitectureDecision(this.database, organizationId, projectId, project.graphVersion),
      businessContextDownstreamGate(this.database, organizationId, projectId, project.graphVersion),
      this.database.select({ id: knowledgeEntities.id, category: knowledgeEntities.category, text: knowledgeEntities.text, truthStatus: knowledgeEntities.truthStatus })
        .from(knowledgeEntities).where(and(
          eq(knowledgeEntities.organizationId, organizationId),
          eq(knowledgeEntities.projectId, projectId),
          eq(knowledgeEntities.graphVersion, project.graphVersion),
          inArray(knowledgeEntities.truthStatus, ['SOURCE_GROUNDED', 'HUMAN_CONFIRMED'])
        )).orderBy(asc(knowledgeEntities.position)),
      this.database.select({
        id: projectGaps.id,
        title: projectGaps.title,
        description: projectGaps.description,
        affectedEntityIds: projectGaps.affectedEntityIds,
        severity: projectGaps.severity,
        status: projectGaps.status,
        type: projectGaps.type,
        truthStatus: projectGaps.truthStatus
      }).from(projectGaps).where(and(
        eq(projectGaps.organizationId, organizationId),
        eq(projectGaps.projectId, projectId),
        eq(projectGaps.graphVersion, project.graphVersion)
      )).orderBy(asc(projectGaps.position))
    ]);
    const selectedOption = architecture.generation?.options.find((option) => option.id === architecture.decision?.selectedOptionId) ?? null;
    const blockingReasons = [
      ...(businessContextGate.allowed ? [] : [businessContextGate.reason!]),
      ...gaps.filter(isCriticalProjectGap).map((gap) => `Critical gap ${gap.id} remains open.`)
    ];
    return {
      projectId: project.id,
      projectName: project.name,
      projectStatus: project.status,
      graphVersion: project.graphVersion,
      artifactApprovalId: approvalResult.approval?.id ?? null,
      architectureDecisionId: architecture.decision?.id ?? null,
      selectedOption,
      alternativeOptions: architecture.generation?.options.filter((option) => option.id !== selectedOption?.id) ?? [],
      entities: entities.flatMap((entity) => entity.truthStatus === 'SOURCE_GROUNDED' || entity.truthStatus === 'HUMAN_CONFIRMED'
        ? [{ id: entity.id, category: entity.category, text: entity.text, truthStatus: entity.truthStatus }]
        : []),
      openNonCriticalGaps: gaps.filter((gap) => gap.status === 'OPEN' && !isCriticalProjectGap(gap)).map((gap) => ({
        id: gap.id,
        title: gap.title,
        description: gap.description,
        affectedEntityIds: gap.affectedEntityIds,
        severity: gap.severity
      })),
      blockingReasons
    };
  }

  async persist(input: PersistEngineeringPlanInput): Promise<EngineeringPlanPreview> {
    return this.database.transaction(async (transaction) => {
      const [reservation] = await transaction.select().from(idempotencyRecords).where(and(
        eq(idempotencyRecords.organizationId, input.context.organizationId),
        eq(idempotencyRecords.scope, 'ENGINEERING_PLAN_GENERATE'),
        eq(idempotencyRecords.key, input.idempotencyKey)
      )).limit(1).for('update');
      if (reservation === undefined || reservation.requestHash !== input.requestHash || reservation.status !== 'PROCESSING') {
        throw new EngineeringPlanConflictError('Engineering Plan idempotency reservation is not active');
      }

      const [project] = await transaction.select({ status: projects.status, graphVersion: projects.graphVersion }).from(projects)
        .where(and(eq(projects.organizationId, input.context.organizationId), eq(projects.id, input.plan.projectId))).limit(1).for('update');
      if (project === undefined) throw new EngineeringPlanBlockedError(['Project was not found in this organization.']);
      const reasons: string[] = [];
      if (!allowedGenerationStatuses.includes(project.status)) reasons.push(`Project status ${project.status} is not ready for Engineering Plan generation.`);
      if (project.graphVersion !== input.plan.sourceGraphVersion) reasons.push('The canonical graph changed before the Engineering Plan could be persisted.');
      const approval = (await currentArtifactApproval(transaction, input.context.organizationId, input.plan.projectId, input.plan.sourceGraphVersion)).approval;
      const architecture = await currentArchitectureDecision(transaction, input.context.organizationId, input.plan.projectId, input.plan.sourceGraphVersion);
      const businessContextGate = await businessContextDownstreamGate(transaction, input.context.organizationId, input.plan.projectId, input.plan.sourceGraphVersion);
      const gapStates = await transaction.select({ id: projectGaps.id, type: projectGaps.type, severity: projectGaps.severity, status: projectGaps.status, truthStatus: projectGaps.truthStatus })
        .from(projectGaps).where(and(
          eq(projectGaps.organizationId, input.context.organizationId),
          eq(projectGaps.projectId, input.plan.projectId),
          eq(projectGaps.graphVersion, input.plan.sourceGraphVersion)
        ));
      if (approval?.id !== input.plan.artifactApprovalId) reasons.push('The exact artifact approval changed before persistence.');
      if (architecture.decision?.id !== input.plan.architectureDecisionId) reasons.push('The architecture decision changed before persistence.');
      if (architecture.decision?.selectedOptionId !== input.plan.architectureOptionId) reasons.push('The selected architecture option changed before persistence.');
      if (!businessContextGate.allowed) reasons.push(businessContextGate.reason!);
      const blockers = gapStates.filter(isCriticalProjectGap);
      if (blockers.length > 0) reasons.push(`Critical gaps remain open: ${blockers.map((gap) => gap.id).join(', ')}.`);
      if (reasons.length > 0) throw new EngineeringPlanBlockedError(reasons);

      const [latest] = await transaction.select({ version: engineeringPlanGenerations.version }).from(engineeringPlanGenerations)
        .where(and(eq(engineeringPlanGenerations.organizationId, input.context.organizationId), eq(engineeringPlanGenerations.projectId, input.plan.projectId)))
        .orderBy(desc(engineeringPlanGenerations.version)).limit(1);
      const version = (latest?.version ?? 0) + 1;
      const contentHash = sha256(input.plan);
      const createdAt = new Date().toISOString();
      await transaction.insert(engineeringPlanGenerations).values({
        id: input.id,
        organizationId: input.context.organizationId,
        projectId: input.plan.projectId,
        sourceGraphVersion: input.plan.sourceGraphVersion,
        version,
        status: 'DRAFT',
        contentHash,
        schemaVersion: input.plan.schemaVersion,
        evaluatorVersion: input.qualityReport.evaluatorVersion,
        promptVersion: input.plan.promptVersion,
        workflowVersion: input.plan.workflowVersion,
        referenceCatalogVersion: input.plan.referenceCatalogVersion,
        artifactApprovalId: input.plan.artifactApprovalId,
        architectureDecisionId: input.plan.architectureDecisionId,
        architectureOptionId: input.plan.architectureOptionId,
        agentRunId: input.provenance.runId,
        plan: input.plan,
        qualityReport: input.qualityReport,
        createdByUserId: input.context.userId,
        requestId: input.requestId,
        createdAt
      });
      const referenceIds = [...new Set(input.plan.recommendations.flatMap((recommendation) => recommendation.referenceIds))];
      const preview = EngineeringPlanPreviewSchema.parse({
        id: input.id,
        version,
        status: 'DRAFT',
        contentHash,
        plan: input.plan,
        qualityReport: input.qualityReport,
        provenance: input.provenance,
        references: engineeringReferencesFor(referenceIds),
        replayed: false
      });
      await transaction.insert(auditEvents).values({
        id: `AUDIT-${randomUUID()}`,
        organizationId: input.context.organizationId,
        actorUserId: input.context.userId,
        action: 'ENGINEERING_PLAN_GENERATED',
        targetType: 'EngineeringPlan',
        targetId: input.id,
        requestId: input.requestId,
        metadata: {
          projectId: input.plan.projectId,
          sourceGraphVersion: input.plan.sourceGraphVersion,
          contentHash,
          recommendationCount: input.plan.recommendations.length,
          referenceCatalogVersion: input.plan.referenceCatalogVersion,
          evaluatorVersion: input.qualityReport.evaluatorVersion,
          sessionId: input.context.sessionId
        }
      });
      await transaction.update(idempotencyRecords).set({ status: 'COMPLETED', responseStatus: 201, responsePayload: preview, updatedAt: createdAt })
        .where(eq(idempotencyRecords.id, reservation.id));
      return preview;
    });
  }

  async reserve(organizationId: string, idempotencyKey: string, requestHash: string): Promise<EngineeringPlanPreview | null> {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
    const [reservation] = await this.database.insert(idempotencyRecords).values({
      id: `IDEMP-${randomUUID()}`,
      organizationId,
      scope: 'ENGINEERING_PLAN_GENERATE',
      key: idempotencyKey,
      requestHash,
      expiresAt
    }).onConflictDoNothing().returning({ id: idempotencyRecords.id });
    if (reservation !== undefined) return null;
    const [existing] = await this.database.select().from(idempotencyRecords).where(and(
      eq(idempotencyRecords.organizationId, organizationId),
      eq(idempotencyRecords.scope, 'ENGINEERING_PLAN_GENERATE'),
      eq(idempotencyRecords.key, idempotencyKey)
    )).limit(1);
    if (existing === undefined || existing.requestHash !== requestHash) throw new EngineeringPlanConflictError('Idempotency key was used for another Engineering Plan request');
    if (existing.status === 'COMPLETED' && existing.responsePayload !== null) return EngineeringPlanPreviewSchema.parse({ ...existing.responsePayload, replayed: true });
    throw new EngineeringPlanConflictError('Engineering Plan generation with this idempotency key is still processing');
  }

  async release(organizationId: string, idempotencyKey: string, requestHash: string): Promise<void> {
    await this.database.delete(idempotencyRecords).where(and(
      eq(idempotencyRecords.organizationId, organizationId),
      eq(idempotencyRecords.scope, 'ENGINEERING_PLAN_GENERATE'),
      eq(idempotencyRecords.key, idempotencyKey),
      eq(idempotencyRecords.requestHash, requestHash),
      eq(idempotencyRecords.status, 'PROCESSING')
    ));
  }

  async latest(organizationId: string, projectId: string): Promise<EngineeringPlanPreview | null> {
    const [generation] = await this.database.select().from(engineeringPlanGenerations).where(and(
      eq(engineeringPlanGenerations.organizationId, organizationId),
      eq(engineeringPlanGenerations.projectId, projectId)
    )).orderBy(desc(engineeringPlanGenerations.version), desc(engineeringPlanGenerations.createdAt)).limit(1);
    if (generation === undefined) return null;
    const plan = EngineeringPlanSchema.parse(generation.plan);
    const [run] = await this.database.select().from(agentRuns).where(and(eq(agentRuns.organizationId, organizationId), eq(agentRuns.id, generation.agentRunId))).limit(1);
    const [call] = run?.finalModelCallId === null || run?.finalModelCallId === undefined ? [] : await this.database.select().from(modelCalls).where(and(
      eq(modelCalls.organizationId, organizationId),
      eq(modelCalls.id, run.finalModelCallId)
    )).limit(1);
    const provenance = run === undefined || call === undefined || run.completedAt === null || call.usage === null ? null : {
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
        ? { status: 'NOT_APPLICABLE' as const, reason: 'NON_BILLABLE_LOCAL_FIXTURE' as const }
        : { status: 'RESERVED' as const, reservationId: run.budgetReservationId! },
      usage: call.usage,
      attemptCount: call.attempt,
      fallbackUsed: false,
      latencyMs: call.latencyMs,
      completedAt: new Date(run.completedAt).toISOString()
    };
    const referenceIds = [...new Set(plan.recommendations.flatMap((recommendation) => recommendation.referenceIds))] as EngineeringReferenceId[];
    return EngineeringPlanPreviewSchema.parse({
      id: generation.id,
      version: generation.version,
      status: generation.status,
      contentHash: generation.contentHash,
      plan,
      qualityReport: generation.qualityReport,
      provenance,
      references: engineeringReferencesFor(referenceIds),
      replayed: false
    });
  }
}
