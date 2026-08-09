import { createHash, randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, sql } from 'drizzle-orm';

import type { AxiomDatabase } from '../database/client';
import { DATABASE } from '../database/database.module';
import {
  auditEvents,
  clarificationQuestions,
  documentApprovals,
  idempotencyRecords,
  knowledgeEntities,
  projectDocuments,
  projectGaps,
  projectGraphs,
  projectSources,
  projects
} from '../database/schema';
import { isCriticalProjectGap } from '../projects/project-gap.policy';
import { ProjectReadinessSchema } from '../projects/project-readiness.policy';
import { ProjectResponseSchema } from '../projects/project.schema';
import { compileRequirementBaseline } from './artifact.compiler';
import { findExactArtifactApproval, latestArtifactHashes } from './artifact-approval.policy';
import {
  ArtifactBlockedError,
  ArtifactConflictError,
  ArtifactNotFoundError,
  ArtifactVersionConflictError,
  type ArtifactApprovalInput,
  type ArtifactMutationInput,
  type ArtifactRepository
} from './artifact.repository';
import {
  ArtifactApprovalResponseSchema,
  ArtifactApprovalSchema,
  ArtifactBaselineSchema,
  ArtifactGenerationResponseSchema,
  ArtifactTypeSchema,
  ProjectArtifactSchema,
  type ArtifactApproval,
  type ArtifactBaseline,
  type ProjectArtifact
} from './artifact.schema';

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

function artifactFromRow(row: typeof projectDocuments.$inferSelect): ProjectArtifact | null {
  const artifact = ProjectArtifactSchema.safeParse({
    id: row.id,
    projectId: row.projectId,
    type: row.type,
    version: row.version,
    sourceGraphVersion: row.sourceGraphVersion,
    title: row.title,
    content: row.content,
    sha256: row.sha256,
    truthStatus: row.truthStatus,
    provenance: row.metadata,
    generatedAt: new Date(row.generatedAt).toISOString()
  });
  return artifact.success ? artifact.data : null;
}

function hashesFor(artifacts: ProjectArtifact[]) {
  return latestArtifactHashes(artifacts);
}

async function baselineFor(executor: DatabaseExecutor, organizationId: string, projectId: string, graphVersion: number): Promise<ArtifactBaseline> {
  const rows = await executor.select().from(projectDocuments).where(and(
    eq(projectDocuments.organizationId, organizationId),
    eq(projectDocuments.projectId, projectId),
    eq(projectDocuments.sourceGraphVersion, graphVersion)
  )).orderBy(desc(projectDocuments.version), asc(projectDocuments.type));
  const latest = new Map<string, ProjectArtifact>();
  for (const row of rows) {
    if (!ArtifactTypeSchema.safeParse(row.type).success || latest.has(row.type)) continue;
    const artifact = artifactFromRow(row);
    if (artifact !== null) latest.set(row.type, artifact);
  }
  const artifacts = ArtifactTypeSchema.options.flatMap((type) => {
    const artifact = latest.get(type);
    return artifact === undefined ? [] : [artifact];
  });
  const hashes = hashesFor(artifacts);
  const approvalRows = await executor.select().from(documentApprovals).where(and(
    eq(documentApprovals.organizationId, organizationId),
    eq(documentApprovals.projectId, projectId),
    eq(documentApprovals.graphVersion, graphVersion)
  )).orderBy(desc(documentApprovals.approvedAt));
  const approval: ArtifactApproval | null = findExactArtifactApproval(approvalRows.map((row) => row.payload), hashes);
  return ArtifactBaselineSchema.parse({ projectId, graphVersion, artifacts, approval });
}

@Injectable()
export class PostgresArtifactRepository implements ArtifactRepository {
  constructor(@Inject(DATABASE) private readonly database: AxiomDatabase) {}

  async current(organizationId: string, projectId: string) {
    const [project] = await this.database.select({ id: projects.id, graphVersion: projects.graphVersion }).from(projects).where(and(
      eq(projects.organizationId, organizationId), eq(projects.id, projectId)
    )).limit(1);
    if (project === undefined) return null;
    return baselineFor(this.database, organizationId, projectId, project.graphVersion);
  }

  async generate(input: ArtifactMutationInput) {
    return this.database.transaction(async (transaction) => {
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
      const [reservation] = await transaction.insert(idempotencyRecords).values({
        id: `IDEMP-${randomUUID()}`, organizationId: input.context.organizationId, scope: 'ARTIFACT_GENERATE',
        key: input.idempotencyKey, requestHash: input.requestHash, expiresAt
      }).onConflictDoNothing().returning({ id: idempotencyRecords.id });
      if (reservation === undefined) {
        const [existing] = await transaction.select().from(idempotencyRecords).where(and(
          eq(idempotencyRecords.organizationId, input.context.organizationId),
          eq(idempotencyRecords.scope, 'ARTIFACT_GENERATE'), eq(idempotencyRecords.key, input.idempotencyKey)
        )).limit(1).for('update');
        if (existing === undefined || existing.requestHash !== input.requestHash) throw new ArtifactConflictError('Idempotency key was used for another artifact generation');
        if (existing.status === 'COMPLETED' && existing.responsePayload !== null) return ArtifactGenerationResponseSchema.parse({ ...existing.responsePayload, replayed: true });
        throw new ArtifactConflictError('Artifact generation with this idempotency key is still processing');
      }

      const [project] = await transaction.select().from(projects).where(and(
        eq(projects.organizationId, input.context.organizationId), eq(projects.id, input.projectId)
      )).limit(1).for('update');
      if (project === undefined) throw new ArtifactNotFoundError('Project was not found');
      if (project.rowVersion !== input.expectedRowVersion) throw new ArtifactVersionConflictError('Project changed before artifact generation');
      if (project.status === 'ARCHIVED' || project.status === 'SOURCES_READY' || project.graphVersion < 1 || project.graphVersion !== input.sourceGraphVersion) throw new ArtifactBlockedError('Artifacts require analysis of the exact current source set and active graph');
      const [graph] = await transaction.select().from(projectGraphs).where(and(
        eq(projectGraphs.organizationId, input.context.organizationId), eq(projectGraphs.projectId, input.projectId),
        eq(projectGraphs.graphVersion, input.sourceGraphVersion)
      )).limit(1);
      if (graph === undefined) throw new ArtifactNotFoundError('Current project graph was not found');
      const readiness = ProjectReadinessSchema.safeParse(graph.readiness);
      if (!readiness.success) throw new ArtifactBlockedError('The current graph has no valid deterministic readiness calculation');
      const entities = await transaction.select().from(knowledgeEntities).where(and(
        eq(knowledgeEntities.organizationId, input.context.organizationId), eq(knowledgeEntities.projectId, input.projectId),
        eq(knowledgeEntities.graphVersion, input.sourceGraphVersion)
      )).orderBy(knowledgeEntities.position);
      const gaps = await transaction.select().from(projectGaps).where(and(
        eq(projectGaps.organizationId, input.context.organizationId), eq(projectGaps.projectId, input.projectId),
        eq(projectGaps.graphVersion, input.sourceGraphVersion)
      )).orderBy(projectGaps.position);
      const questions = await transaction.select().from(clarificationQuestions).where(and(
        eq(clarificationQuestions.organizationId, input.context.organizationId), eq(clarificationQuestions.projectId, input.projectId),
        eq(clarificationQuestions.graphVersion, input.sourceGraphVersion)
      )).orderBy(clarificationQuestions.position);
      const sources = await transaction.select().from(projectSources).where(and(
        eq(projectSources.organizationId, input.context.organizationId), eq(projectSources.projectId, input.projectId)
      )).orderBy(projectSources.createdAt, projectSources.id);
      const previous = await transaction.select({ type: projectDocuments.type, version: projectDocuments.version }).from(projectDocuments).where(and(
        eq(projectDocuments.organizationId, input.context.organizationId), eq(projectDocuments.projectId, input.projectId)
      ));
      const versions = Object.fromEntries(ArtifactTypeSchema.options.map((type) => [
        type, Math.max(0, ...previous.filter((row) => row.type === type).map((row) => row.version)) + 1
      ])) as Record<'requirements' | 'srs' | 'nfr', number>;
      const generatedAt = new Date().toISOString();
      const artifacts = compileRequirementBaseline({
        project, graphVersion: project.graphVersion, summary: graph.summary, readiness: readiness.data,
        entities, gaps, questions, sources, versions, generatedAt
      });
      await transaction.insert(projectDocuments).values(artifacts.map((artifact) => ({
        id: artifact.id, organizationId: input.context.organizationId, projectId: artifact.projectId, type: artifact.type,
        version: artifact.version, sourceGraphVersion: artifact.sourceGraphVersion, title: artifact.title, content: artifact.content,
        sha256: artifact.sha256, truthStatus: artifact.truthStatus, metadata: artifact.provenance, generatedAt: artifact.generatedAt
      })));
      const hasCriticalGap = gaps.some(isCriticalProjectGap);
      const nextStatus = hasCriticalGap ? 'NEEDS_CLARIFICATION' as const : 'DOCUMENTED' as const;
      const [updated] = await transaction.update(projects).set({
        status: nextStatus, rowVersion: sql`${projects.rowVersion} + 1`, updatedAt: generatedAt
      }).where(and(eq(projects.organizationId, input.context.organizationId), eq(projects.id, input.projectId), eq(projects.rowVersion, input.expectedRowVersion))).returning();
      if (updated === undefined) throw new ArtifactVersionConflictError('Project changed before artifact generation');
      const baseline = ArtifactBaselineSchema.parse({ projectId: input.projectId, graphVersion: input.sourceGraphVersion, artifacts, approval: null });
      const response = ArtifactGenerationResponseSchema.parse({ project: projectResponse(updated), baseline, replayed: false });
      await transaction.insert(auditEvents).values({
        id: `AUDIT-${randomUUID()}`, organizationId: input.context.organizationId, actorUserId: input.context.userId,
        action: 'REQUIREMENT_BASELINE_GENERATED', targetType: 'Project', targetId: input.projectId, requestId: input.requestId,
        metadata: { graphVersion: input.sourceGraphVersion, artifactHashes: Object.fromEntries(artifacts.map((artifact) => [artifact.type, artifact.sha256])), compilerVersion: artifacts[0]?.provenance.compilerVersion, sessionId: input.context.sessionId }
      });
      await transaction.update(idempotencyRecords).set({ status: 'COMPLETED', responseStatus: 201, responsePayload: response, updatedAt: generatedAt }).where(eq(idempotencyRecords.id, reservation.id));
      return response;
    });
  }

  async approve(input: ArtifactApprovalInput) {
    return this.database.transaction(async (transaction) => {
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
      const [reservation] = await transaction.insert(idempotencyRecords).values({
        id: `IDEMP-${randomUUID()}`, organizationId: input.context.organizationId, scope: 'ARTIFACT_APPROVE',
        key: input.idempotencyKey, requestHash: input.requestHash, expiresAt
      }).onConflictDoNothing().returning({ id: idempotencyRecords.id });
      if (reservation === undefined) {
        const [existing] = await transaction.select().from(idempotencyRecords).where(and(
          eq(idempotencyRecords.organizationId, input.context.organizationId),
          eq(idempotencyRecords.scope, 'ARTIFACT_APPROVE'), eq(idempotencyRecords.key, input.idempotencyKey)
        )).limit(1).for('update');
        if (existing === undefined || existing.requestHash !== input.requestHash) throw new ArtifactConflictError('Idempotency key was used for another artifact approval');
        if (existing.status === 'COMPLETED' && existing.responsePayload !== null) return ArtifactApprovalResponseSchema.parse({ ...existing.responsePayload, replayed: true });
        throw new ArtifactConflictError('Artifact approval with this idempotency key is still processing');
      }
      const [project] = await transaction.select().from(projects).where(and(
        eq(projects.organizationId, input.context.organizationId), eq(projects.id, input.projectId)
      )).limit(1).for('update');
      if (project === undefined) throw new ArtifactNotFoundError('Project was not found');
      if (project.rowVersion !== input.expectedRowVersion) throw new ArtifactVersionConflictError('Project changed before artifact approval');
      if (project.status === 'ARCHIVED' || project.status === 'SOURCES_READY' || project.graphVersion !== input.sourceGraphVersion) throw new ArtifactBlockedError('Approval requires analysis of the exact current source set and active graph');
      const baseline = await baselineFor(transaction, input.context.organizationId, input.projectId, input.sourceGraphVersion);
      const currentHashes = hashesFor(baseline.artifacts);
      if (currentHashes === null) throw new ArtifactBlockedError('Generate all three current-graph requirement artifacts before approval');
      if (JSON.stringify(currentHashes) !== JSON.stringify(input.documentHashes)) throw new ArtifactVersionConflictError('Artifact hashes changed before approval');
      if (baseline.approval !== null) throw new ArtifactConflictError('This exact requirement baseline is already approved');
      const gaps = await transaction.select({
        id: projectGaps.id, type: projectGaps.type, severity: projectGaps.severity, status: projectGaps.status, truthStatus: projectGaps.truthStatus
      }).from(projectGaps).where(and(
        eq(projectGaps.organizationId, input.context.organizationId), eq(projectGaps.projectId, input.projectId),
        eq(projectGaps.graphVersion, input.sourceGraphVersion)
      ));
      const blockers = gaps.filter(isCriticalProjectGap);
      if (blockers.length > 0) throw new ArtifactBlockedError(`Critical gaps remain open: ${blockers.map((gap) => gap.id).join(', ')}`);
      const approvedAt = new Date().toISOString();
      const approval = ArtifactApprovalSchema.parse({
        id: `DOCAPP-${randomUUID()}`, projectId: input.projectId, graphVersion: input.sourceGraphVersion,
        documentHashes: input.documentHashes, comment: input.comment, truthStatus: 'HUMAN_APPROVED',
        approvedByUserId: input.context.userId, approvedAt
      });
      await transaction.insert(documentApprovals).values({
        id: approval.id, organizationId: input.context.organizationId, projectId: input.projectId,
        graphVersion: input.sourceGraphVersion, payload: approval, approvedAt
      });
      const [updated] = await transaction.update(projects).set({
        status: 'DOCUMENTS_APPROVED', rowVersion: sql`${projects.rowVersion} + 1`, updatedAt: approvedAt
      }).where(and(eq(projects.organizationId, input.context.organizationId), eq(projects.id, input.projectId), eq(projects.rowVersion, input.expectedRowVersion))).returning();
      if (updated === undefined) throw new ArtifactVersionConflictError('Project changed before artifact approval');
      const approvedBaseline = ArtifactBaselineSchema.parse({ ...baseline, approval });
      const response = ArtifactApprovalResponseSchema.parse({ project: projectResponse(updated), baseline: approvedBaseline, replayed: false });
      await transaction.insert(auditEvents).values({
        id: `AUDIT-${randomUUID()}`, organizationId: input.context.organizationId, actorUserId: input.context.userId,
        action: 'REQUIREMENT_BASELINE_APPROVED', targetType: 'DocumentApproval', targetId: approval.id, requestId: input.requestId,
        metadata: { projectId: input.projectId, graphVersion: input.sourceGraphVersion, documentHashes: input.documentHashes, commentHash: createHash('sha256').update(input.comment, 'utf8').digest('hex'), sessionId: input.context.sessionId }
      });
      await transaction.update(idempotencyRecords).set({ status: 'COMPLETED', responseStatus: 201, responsePayload: response, updatedAt: approvedAt }).where(eq(idempotencyRecords.id, reservation.id));
      return response;
    });
  }
}
