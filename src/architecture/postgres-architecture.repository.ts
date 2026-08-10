import { createHash, randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, sql } from 'drizzle-orm';

import { currentArtifactApproval } from '../artifacts/postgres-artifact-approval.query';
import type { AxiomDatabase } from '../database/client';
import { DATABASE } from '../database/database.module';
import { claimPostgresIdempotency, completePostgresIdempotency } from '../database/idempotency/postgres-idempotency';
import {
  arbDecisions,
  architectureGenerations,
  architectureOptionVersions,
  auditEvents,
  knowledgeEntities,
  projectDocuments,
  projectGaps,
  projectGraphs,
  projects
} from '../database/schema';
import { businessContextDownstreamGate } from '../experience/postgres-business-context-gate.query';
import { isCriticalProjectGap } from '../projects/project-gap.policy';
import { ProjectResponseSchema } from '../projects/project.schema';
import { compileApprovedArchitectureArtifacts, compileArchitectureGeneration } from './architecture.compiler';
import {
  ArchitectureBaselineSchema,
  ArchitectureDecisionSchema,
  ArchitectureMutationResponseSchema,
  ArchitectureArtifactSchema,
  type ArchitectureArtifact,
  type ArchitectureBaseline
} from './architecture.schema';
import {
  ArchitectureBlockedError,
  ArchitectureConflictError,
  ArchitectureNotFoundError,
  ArchitectureVersionConflictError,
  type ArchitectureDecisionInput,
  type ArchitectureMutationInput,
  type ArchitectureRepository
} from './architecture.repository';
import { currentArchitectureDecision } from './postgres-architecture-decision.query';

type DatabaseReader = Pick<AxiomDatabase, 'select'>;

function projectResponse(project: typeof projects.$inferSelect) {
  return ProjectResponseSchema.parse({
    id: project.id, workspaceId: project.workspaceId, name: project.name, status: project.status,
    graphVersion: project.graphVersion, rowVersion: project.rowVersion,
    archivedAt: project.archivedAt === null ? null : new Date(project.archivedAt).toISOString(),
    createdAt: new Date(project.createdAt).toISOString(), updatedAt: new Date(project.updatedAt).toISOString()
  });
}

function architectureArtifact(row: typeof projectDocuments.$inferSelect): ArchitectureArtifact | null {
  const parsed = ArchitectureArtifactSchema.safeParse({
    id: row.id, projectId: row.projectId, type: row.type, version: row.version,
    sourceGraphVersion: row.sourceGraphVersion, title: row.title, content: row.content, sha256: row.sha256,
    truthStatus: row.truthStatus, provenance: row.metadata, generatedAt: new Date(row.generatedAt).toISOString()
  });
  return parsed.success ? parsed.data : null;
}

async function baselineFor(executor: DatabaseReader, organizationId: string, projectId: string, graphVersion: number): Promise<ArchitectureBaseline> {
  const { generation, decision } = await currentArchitectureDecision(executor, organizationId, projectId, graphVersion);
  if (generation === null || decision === null) return ArchitectureBaselineSchema.parse({ projectId, graphVersion, generation, decision, artifacts: [] });
  const rows = await executor.select().from(projectDocuments).where(and(
    eq(projectDocuments.organizationId, organizationId), eq(projectDocuments.projectId, projectId), eq(projectDocuments.sourceGraphVersion, graphVersion)
  )).orderBy(desc(projectDocuments.version), asc(projectDocuments.type));
  const latest = new Map<string, ArchitectureArtifact>();
  for (const row of rows) {
    if ((row.type !== 'hld' && row.type !== 'adr') || latest.has(row.type)) continue;
    const artifact = architectureArtifact(row);
    if (artifact?.provenance.decisionId === decision.id && artifact.provenance.generationId === generation.id) latest.set(row.type, artifact);
  }
  const artifacts = ['hld', 'adr'].flatMap((type) => {
    const artifact = latest.get(type);
    return artifact === undefined ? [] : [artifact];
  });
  return ArchitectureBaselineSchema.parse({ projectId, graphVersion, generation, decision, artifacts });
}

@Injectable()
export class PostgresArchitectureRepository implements ArchitectureRepository {
  constructor(@Inject(DATABASE) private readonly database: AxiomDatabase) {}

  async current(organizationId: string, projectId: string) {
    const [project] = await this.database.select({ id: projects.id, graphVersion: projects.graphVersion }).from(projects).where(and(
      eq(projects.organizationId, organizationId), eq(projects.id, projectId)
    )).limit(1);
    if (project === undefined) return null;
    return baselineFor(this.database, organizationId, projectId, project.graphVersion);
  }

  async generate(input: ArchitectureMutationInput) {
    return this.database.transaction(async (transaction) => {
      const reservation = await claimPostgresIdempotency(transaction, {
        organizationId: input.context.organizationId,
        scope: 'ARCHITECTURE_GENERATE',
        key: input.idempotencyKey,
        requestHash: input.requestHash
      });
      if (reservation.kind === 'HASH_CONFLICT') throw new ArchitectureConflictError('Idempotency key was used for another architecture generation');
      if (reservation.kind === 'REPLAY') return ArchitectureMutationResponseSchema.parse({ ...reservation.responsePayload, replayed: true });
      if (reservation.kind === 'IN_PROGRESS') throw new ArchitectureConflictError('Architecture generation with this idempotency key is still processing');
      const [project] = await transaction.select().from(projects).where(and(
        eq(projects.organizationId, input.context.organizationId), eq(projects.id, input.projectId)
      )).limit(1).for('update');
      if (project === undefined) throw new ArchitectureNotFoundError('Project was not found');
      if (project.rowVersion !== input.expectedRowVersion) throw new ArchitectureVersionConflictError('Project changed before architecture generation');
      if (project.status === 'ARCHIVED' || project.status === 'SOURCES_READY' || project.graphVersion !== input.sourceGraphVersion || project.graphVersion < 1) throw new ArchitectureBlockedError('Architecture generation requires analysis of the exact current source set and active graph');
      const businessContextGate = await businessContextDownstreamGate(transaction, input.context.organizationId, input.projectId, input.sourceGraphVersion);
      if (!businessContextGate.allowed) throw new ArchitectureBlockedError(businessContextGate.reason!);
      const artifactApproval = await currentArtifactApproval(transaction, input.context.organizationId, input.projectId, input.sourceGraphVersion);
      if (artifactApproval.approval === null || artifactApproval.hashes === null) throw new ArchitectureBlockedError('Approve the exact current requirement baseline before architecture generation');
      const [graph] = await transaction.select().from(projectGraphs).where(and(
        eq(projectGraphs.organizationId, input.context.organizationId), eq(projectGraphs.projectId, input.projectId), eq(projectGraphs.graphVersion, input.sourceGraphVersion)
      )).limit(1);
      if (graph === undefined) throw new ArchitectureNotFoundError('Current project graph was not found');
      const gaps = await transaction.select().from(projectGaps).where(and(
        eq(projectGaps.organizationId, input.context.organizationId), eq(projectGaps.projectId, input.projectId), eq(projectGaps.graphVersion, input.sourceGraphVersion)
      )).orderBy(projectGaps.position);
      const blockers = gaps.filter(isCriticalProjectGap);
      if (blockers.length > 0) throw new ArchitectureBlockedError(`Critical gaps remain open: ${blockers.map((gap) => gap.id).join(', ')}`);
      const entities = await transaction.select().from(knowledgeEntities).where(and(
        eq(knowledgeEntities.organizationId, input.context.organizationId), eq(knowledgeEntities.projectId, input.projectId), eq(knowledgeEntities.graphVersion, input.sourceGraphVersion)
      )).orderBy(knowledgeEntities.position);
      const [latest] = await transaction.select({ version: architectureGenerations.version }).from(architectureGenerations).where(and(
        eq(architectureGenerations.organizationId, input.context.organizationId), eq(architectureGenerations.projectId, input.projectId)
      )).orderBy(desc(architectureGenerations.version)).limit(1);
      const generation = compileArchitectureGeneration({
        generationId: `ARCHGEN-${randomUUID()}`, generationVersion: (latest?.version ?? 0) + 1,
        projectId: project.id, projectName: project.name, graphVersion: project.graphVersion,
        graphSummary: graph.summary, entities, gaps, requirementDocumentHashes: artifactApproval.hashes,
        generatedAt: new Date().toISOString()
      });
      await transaction.insert(architectureGenerations).values({
        id: generation.id, organizationId: input.context.organizationId, projectId: input.projectId,
        graphVersion: input.sourceGraphVersion, version: generation.version, contentHash: generation.contentHash,
        compilerVersion: generation.compilerVersion, payload: generation, createdByUserId: input.context.userId, createdAt: generation.generatedAt
      });
      await transaction.insert(architectureOptionVersions).values(generation.options.map((candidate, position) => ({
        generationId: generation.id, organizationId: input.context.organizationId, projectId: input.projectId,
        optionId: candidate.id, position, contentHash: candidate.sha256, payload: candidate
      })));
      const generatedAt = generation.generatedAt;
      const [updated] = await transaction.update(projects).set({
        status: 'DESIGN_READY', rowVersion: sql`${projects.rowVersion} + 1`, updatedAt: generatedAt
      }).where(and(eq(projects.organizationId, input.context.organizationId), eq(projects.id, input.projectId), eq(projects.rowVersion, input.expectedRowVersion))).returning();
      if (updated === undefined) throw new ArchitectureVersionConflictError('Project changed before architecture generation');
      const baseline = ArchitectureBaselineSchema.parse({ projectId: input.projectId, graphVersion: input.sourceGraphVersion, generation, decision: null, artifacts: [] });
      const response = ArchitectureMutationResponseSchema.parse({ project: projectResponse(updated), baseline, replayed: false });
      await transaction.insert(auditEvents).values({
        id: `AUDIT-${randomUUID()}`, organizationId: input.context.organizationId, actorUserId: input.context.userId,
        action: 'ARCHITECTURE_OPTIONS_GENERATED', targetType: 'ArchitectureGeneration', targetId: generation.id, requestId: input.requestId,
        metadata: { projectId: input.projectId, graphVersion: input.sourceGraphVersion, generationVersion: generation.version, generationContentHash: generation.contentHash, compilerVersion: generation.compilerVersion, sessionId: input.context.sessionId }
      });
      await completePostgresIdempotency(transaction, { recordId: reservation.recordId, responseStatus: 201, responsePayload: response, completedAt: generatedAt });
      return response;
    });
  }

  async approve(input: ArchitectureDecisionInput) {
    return this.database.transaction(async (transaction) => {
      const reservation = await claimPostgresIdempotency(transaction, {
        organizationId: input.context.organizationId,
        scope: 'ARCHITECTURE_APPROVE',
        key: input.idempotencyKey,
        requestHash: input.requestHash
      });
      if (reservation.kind === 'HASH_CONFLICT') throw new ArchitectureConflictError('Idempotency key was used for another architecture decision');
      if (reservation.kind === 'REPLAY') return ArchitectureMutationResponseSchema.parse({ ...reservation.responsePayload, replayed: true });
      if (reservation.kind === 'IN_PROGRESS') throw new ArchitectureConflictError('Architecture decision with this idempotency key is still processing');
      const [project] = await transaction.select().from(projects).where(and(
        eq(projects.organizationId, input.context.organizationId), eq(projects.id, input.projectId)
      )).limit(1).for('update');
      if (project === undefined) throw new ArchitectureNotFoundError('Project was not found');
      if (project.rowVersion !== input.expectedRowVersion) throw new ArchitectureVersionConflictError('Project changed before architecture approval');
      if (project.status === 'ARCHIVED' || project.status === 'SOURCES_READY' || project.graphVersion !== input.sourceGraphVersion) throw new ArchitectureBlockedError('Architecture approval requires analysis of the exact current source set and active graph');
      const businessContextGate = await businessContextDownstreamGate(transaction, input.context.organizationId, input.projectId, input.sourceGraphVersion);
      if (!businessContextGate.allowed) throw new ArchitectureBlockedError(businessContextGate.reason!);
      const artifactApproval = await currentArtifactApproval(transaction, input.context.organizationId, input.projectId, input.sourceGraphVersion);
      if (artifactApproval.approval === null) throw new ArchitectureBlockedError('The exact current requirement baseline approval is no longer valid');
      const baseline = await baselineFor(transaction, input.context.organizationId, input.projectId, input.sourceGraphVersion);
      const generation = baseline.generation;
      if (generation === null) throw new ArchitectureBlockedError('Generate current architecture options before approval');
      if (baseline.decision !== null) throw new ArchitectureConflictError('This exact architecture generation already has an approved decision');
      if (generation.id !== input.generationId || generation.contentHash !== input.generationContentHash) throw new ArchitectureVersionConflictError('Architecture generation changed before approval');
      const selected = generation.options.find((candidate) => candidate.id === input.selectedOptionId);
      if (selected === undefined || selected.sha256 !== input.selectedOptionHash) throw new ArchitectureVersionConflictError('Selected architecture option changed before approval');
      const gaps = await transaction.select().from(projectGaps).where(and(
        eq(projectGaps.organizationId, input.context.organizationId), eq(projectGaps.projectId, input.projectId), eq(projectGaps.graphVersion, input.sourceGraphVersion)
      ));
      const blockers = gaps.filter(isCriticalProjectGap);
      if (blockers.length > 0) throw new ArchitectureBlockedError(`Critical gaps remain open: ${blockers.map((gap) => gap.id).join(', ')}`);
      const [latestDecision] = await transaction.select({ version: arbDecisions.version }).from(arbDecisions).where(and(
        eq(arbDecisions.organizationId, input.context.organizationId), eq(arbDecisions.projectId, input.projectId)
      )).orderBy(desc(arbDecisions.version)).limit(1);
      const approvedAt = new Date().toISOString();
      const decision = ArchitectureDecisionSchema.parse({
        id: `ADR-${randomUUID()}`, projectId: input.projectId, graphVersion: input.sourceGraphVersion,
        version: (latestDecision?.version ?? 0) + 1, generationId: generation.id,
        generationContentHash: generation.contentHash, selectedOptionId: selected.id, selectedOptionHash: selected.sha256,
        comment: input.comment,
        rejectedAlternatives: generation.options.filter((candidate) => candidate.id !== selected.id).map((candidate) => ({ optionId: candidate.id, whyRejected: candidate.whyNot })),
        truthStatus: 'HUMAN_APPROVED', approvedByUserId: input.context.userId, approvedAt
      });
      const previousDocuments = await transaction.select({ type: projectDocuments.type, version: projectDocuments.version }).from(projectDocuments).where(and(
        eq(projectDocuments.organizationId, input.context.organizationId), eq(projectDocuments.projectId, input.projectId)
      ));
      const artifacts = compileApprovedArchitectureArtifacts({
        projectName: project.name, generation, decision,
        versions: {
          hld: Math.max(0, ...previousDocuments.filter((row) => row.type === 'hld').map((row) => row.version)) + 1,
          adr: Math.max(0, ...previousDocuments.filter((row) => row.type === 'adr').map((row) => row.version)) + 1
        }, generatedAt: approvedAt
      });
      await transaction.insert(arbDecisions).values({
        id: decision.id, organizationId: input.context.organizationId, projectId: input.projectId,
        graphVersion: input.sourceGraphVersion, version: decision.version, payload: decision, approvedAt
      });
      await transaction.insert(projectDocuments).values(artifacts.map((artifact) => ({
        id: artifact.id, organizationId: input.context.organizationId, projectId: input.projectId,
        type: artifact.type, version: artifact.version, sourceGraphVersion: artifact.sourceGraphVersion,
        title: artifact.title, content: artifact.content, sha256: artifact.sha256,
        truthStatus: artifact.truthStatus, metadata: artifact.provenance, generatedAt: artifact.generatedAt
      })));
      const [updated] = await transaction.update(projects).set({
        status: 'HLD_READY', rowVersion: sql`${projects.rowVersion} + 1`, updatedAt: approvedAt
      }).where(and(eq(projects.organizationId, input.context.organizationId), eq(projects.id, input.projectId), eq(projects.rowVersion, input.expectedRowVersion))).returning();
      if (updated === undefined) throw new ArchitectureVersionConflictError('Project changed before architecture approval');
      const approvedBaseline = ArchitectureBaselineSchema.parse({ projectId: input.projectId, graphVersion: input.sourceGraphVersion, generation, decision, artifacts });
      const response = ArchitectureMutationResponseSchema.parse({ project: projectResponse(updated), baseline: approvedBaseline, replayed: false });
      await transaction.insert(auditEvents).values({
        id: `AUDIT-${randomUUID()}`, organizationId: input.context.organizationId, actorUserId: input.context.userId,
        action: 'ARCHITECTURE_DECISION_APPROVED', targetType: 'ArchitectureDecision', targetId: decision.id, requestId: input.requestId,
        metadata: { projectId: input.projectId, graphVersion: input.sourceGraphVersion, generationId: generation.id, generationContentHash: generation.contentHash, selectedOptionId: selected.id, selectedOptionHash: selected.sha256, commentHash: createHash('sha256').update(input.comment, 'utf8').digest('hex'), artifactHashes: Object.fromEntries(artifacts.map((artifact) => [artifact.type, artifact.sha256])), sessionId: input.context.sessionId }
      });
      await completePostgresIdempotency(transaction, { recordId: reservation.recordId, responseStatus: 201, responsePayload: response, completedAt: approvedAt });
      return response;
    });
  }
}
