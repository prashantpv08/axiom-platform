import { createHash, randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, max, sql } from 'drizzle-orm';

import type { AxiomDatabase } from '../database/client';
import { DATABASE } from '../database/database.module';
import {
  claimPostgresIdempotency,
  completePostgresIdempotency
} from '../database/idempotency/postgres-idempotency';
import { analysisRuns, auditEvents, projectSources, projects } from '../database/schema';
import {
  AnalysisAlreadyActiveError,
  AnalysisRunNotFoundError,
  AnalysisSourcesUnavailableError,
  SourceIdempotencyConflictError,
  SourceProjectArchivedError,
  SourceProjectNotFoundError,
  type SourceRepository,
  type SourceScope
} from './source.repository';
import { AnalysisRunResponseSchema, SourceResponseSchema, type AnalysisRunResponse } from './source.schema';

function sourceFromRow(row: typeof projectSources.$inferSelect) {
  return SourceResponseSchema.parse({
    id: row.id, workspaceId: row.workspaceId, projectId: row.projectId, name: row.name,
    relativePath: row.relativePath, kind: row.kind, mimeType: row.mimeType, size: row.size,
    sha256: row.sha256, rawPath: row.rawPath, status: row.status, extractionError: row.extractionError,
    sourceKey: row.sourceKey, version: row.version, validationStatus: row.validationStatus,
    validator: row.validator, extractedAt: row.extractedAt === null ? null : new Date(row.extractedAt).toISOString(),
    createdAt: new Date(row.createdAt).toISOString()
  });
}

function analysisRunFromRow(row: typeof analysisRuns.$inferSelect): AnalysisRunResponse {
  return AnalysisRunResponseSchema.parse({
    id: row.id, projectId: row.projectId, status: row.status, analyzer: row.analyzer,
    sourceSnapshotHash: row.sourceSnapshotHash, attempts: row.attempts, graphVersion: row.graphVersion,
    errorCode: row.errorCode, errorMessage: row.errorMessage,
    startedAt: row.startedAt === null ? null : new Date(row.startedAt).toISOString(),
    completedAt: row.completedAt === null ? null : new Date(row.completedAt).toISOString(),
    cancelledAt: row.cancelledAt === null ? null : new Date(row.cancelledAt).toISOString(),
    createdAt: new Date(row.createdAt).toISOString(), updatedAt: new Date(row.updatedAt).toISOString()
  });
}

function postgresErrorCode(cause: unknown): string | undefined {
  let current: unknown = cause;
  for (let depth = 0; depth < 3 && typeof current === 'object' && current !== null; depth += 1) {
    const record = current as Record<string, unknown>;
    if (typeof record.code === 'string') return record.code;
    current = record.cause;
  }
  return undefined;
}

@Injectable()
export class PostgresSourceRepository implements SourceRepository {
  constructor(@Inject(DATABASE) private readonly database: AxiomDatabase) {}

  async projectIdentity(scope: SourceScope, projectId: string) {
    const [project] = await this.database.select({ workspaceId: projects.workspaceId, status: projects.status }).from(projects)
      .where(and(eq(projects.organizationId, scope.organizationId), eq(projects.id, projectId))).limit(1);
    return project ?? null;
  }

  async list(scope: SourceScope, projectId: string) {
    const [project] = await this.database.select({ id: projects.id }).from(projects)
      .where(and(eq(projects.organizationId, scope.organizationId), eq(projects.id, projectId))).limit(1);
    if (project === undefined) return null;
    const rows = await this.database.select().from(projectSources).where(and(
      eq(projectSources.organizationId, scope.organizationId), eq(projectSources.projectId, projectId)
    )).orderBy(desc(projectSources.createdAt), desc(projectSources.id));
    return rows.map(sourceFromRow);
  }

  async create(scope: SourceScope, input: Parameters<SourceRepository['create']>[1]) {
    return this.database.transaction(async (transaction) => {
      const now = new Date().toISOString();
      const reservation = await claimPostgresIdempotency(transaction, {
        organizationId: scope.organizationId,
        scope: `SOURCE_UPLOAD:${input.source.projectId}`,
        key: input.idempotencyKey,
        requestHash: input.requestHash
      });
      if (reservation.kind === 'HASH_CONFLICT') {
        throw new SourceIdempotencyConflictError('Idempotency key was already used for another source');
      }
      if (reservation.kind === 'REPLAY') {
        return { source: SourceResponseSchema.parse(reservation.responsePayload), replayed: true };
      }
      if (reservation.kind === 'IN_PROGRESS') {
        throw new SourceIdempotencyConflictError('Source upload with this idempotency key is still processing');
      }

      const [project] = await transaction.select({ id: projects.id, workspaceId: projects.workspaceId, status: projects.status })
        .from(projects).where(and(eq(projects.organizationId, scope.organizationId), eq(projects.id, input.source.projectId))).limit(1).for('update');
      if (project === undefined) throw new SourceProjectNotFoundError('Project was not found');
      if (project.status === 'ARCHIVED') throw new SourceProjectArchivedError('Archived projects cannot accept sources');
      if (project.workspaceId !== input.source.workspaceId) throw new SourceProjectNotFoundError('Project was not found');

      await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${`${scope.organizationId}:${input.source.projectId}:${input.source.sourceKey}`}))`);
      const [latest] = await transaction.select({ version: max(projectSources.version) }).from(projectSources).where(and(
        eq(projectSources.organizationId, scope.organizationId), eq(projectSources.projectId, input.source.projectId), eq(projectSources.sourceKey, input.source.sourceKey)
      ));
      const version = (latest?.version ?? 0) + 1;
      const [created] = await transaction.insert(projectSources).values({
        ...input.source, organizationId: scope.organizationId, version, extractedText: input.extractedText,
        uploadedByUserId: input.actorUserId
      }).returning();
      if (created === undefined) throw new Error('Source insert did not return a row');
      const source = sourceFromRow(created);
      await transaction.update(projects).set({ status: 'SOURCES_READY', rowVersion: sql`${projects.rowVersion} + 1`, updatedAt: now })
        .where(and(eq(projects.organizationId, scope.organizationId), eq(projects.id, input.source.projectId)));
      await transaction.insert(auditEvents).values({
        id: `AUDIT-${randomUUID()}`, organizationId: scope.organizationId, actorUserId: input.actorUserId,
        action: 'PROJECT_SOURCE_UPLOADED', targetType: 'ProjectSource', targetId: source.id,
        requestId: input.requestId, metadata: { projectId: source.projectId, sha256: source.sha256, version: source.version, status: source.status }
      });
      await completePostgresIdempotency(transaction, {
        recordId: reservation.recordId,
        responseStatus: 201,
        responsePayload: source,
        completedAt: now
      });
      return { source, replayed: false };
    });
  }

  async queueAnalysis(scope: SourceScope, input: Parameters<SourceRepository['queueAnalysis']>[1]) {
    try {
      return await this.database.transaction(async (transaction) => {
        const now = new Date().toISOString();
        const reservation = await claimPostgresIdempotency(transaction, {
          organizationId: scope.organizationId,
          scope: `ANALYSIS_QUEUE:${input.projectId}`,
          key: input.idempotencyKey,
          requestHash: input.requestHash
        });
        if (reservation.kind === 'HASH_CONFLICT') {
          throw new SourceIdempotencyConflictError('Idempotency key was already used for another analysis request');
        }
        if (reservation.kind === 'REPLAY') {
          return { run: AnalysisRunResponseSchema.parse(reservation.responsePayload), replayed: true };
        }
        if (reservation.kind === 'IN_PROGRESS') {
          throw new SourceIdempotencyConflictError('Analysis request with this idempotency key is still processing');
        }
        const [project] = await transaction.select({ id: projects.id, status: projects.status }).from(projects)
          .where(and(eq(projects.organizationId, scope.organizationId), eq(projects.id, input.projectId))).limit(1).for('update');
        if (project === undefined) throw new SourceProjectNotFoundError('Project was not found');
        if (project.status === 'ARCHIVED') throw new SourceProjectArchivedError('Archived projects cannot be analyzed');
        const sources = await transaction.select({ id: projectSources.id, sha256: projectSources.sha256, version: projectSources.version })
          .from(projectSources).where(and(eq(projectSources.organizationId, scope.organizationId), eq(projectSources.projectId, input.projectId), eq(projectSources.status, 'EXTRACTED')))
          .orderBy(asc(projectSources.id));
        if (sources.length === 0) throw new AnalysisSourcesUnavailableError('No successfully extracted sources are available');
        const snapshot = createHash('sha256').update(JSON.stringify(sources), 'utf8').digest('hex');
        const [created] = await transaction.insert(analysisRuns).values({
          id: input.runId, organizationId: scope.organizationId, projectId: input.projectId,
          requestedByUserId: input.actorUserId, requestId: input.requestId, analyzer: input.analyzer,
          sourceSnapshotHash: snapshot
        }).returning();
        if (created === undefined) throw new Error('Analysis run insert did not return a row');
        const run = analysisRunFromRow(created);
        await transaction.insert(auditEvents).values({
          id: `AUDIT-${randomUUID()}`, organizationId: scope.organizationId, actorUserId: input.actorUserId,
          action: 'PROJECT_ANALYSIS_QUEUED', targetType: 'AnalysisRun', targetId: run.id,
          requestId: input.requestId, metadata: { projectId: input.projectId, sourceSnapshotHash: run.sourceSnapshotHash }
        });
        await completePostgresIdempotency(transaction, {
          recordId: reservation.recordId,
          responseStatus: 202,
          responsePayload: run,
          completedAt: now
        });
        return { run, replayed: false };
      });
    } catch (cause) {
      if (postgresErrorCode(cause) === '23505') throw new AnalysisAlreadyActiveError('An analysis run is already queued or running for this project');
      throw cause;
    }
  }

  async findAnalysisRun(scope: SourceScope, projectId: string, runId: string) {
    const [row] = await this.database.select().from(analysisRuns).where(and(
      eq(analysisRuns.organizationId, scope.organizationId), eq(analysisRuns.projectId, projectId), eq(analysisRuns.id, runId)
    )).limit(1);
    return row === undefined ? null : analysisRunFromRow(row);
  }

  async latestAnalysisRun(scope: SourceScope, projectId: string) {
    const [row] = await this.database.select().from(analysisRuns).where(and(
      eq(analysisRuns.organizationId, scope.organizationId), eq(analysisRuns.projectId, projectId)
    )).orderBy(desc(analysisRuns.createdAt), desc(analysisRuns.id)).limit(1);
    return row === undefined ? null : analysisRunFromRow(row);
  }

  async cancelAnalysisRun(scope: SourceScope, projectId: string, runId: string, actorUserId: string, requestId: string) {
    return this.database.transaction(async (transaction) => {
      const [existing] = await transaction.select().from(analysisRuns).where(and(
        eq(analysisRuns.organizationId, scope.organizationId), eq(analysisRuns.projectId, projectId), eq(analysisRuns.id, runId)
      )).limit(1).for('update');
      if (existing === undefined) return null;
      if (existing.status === 'SUCCEEDED' || existing.status === 'FAILED' || existing.status === 'CANCELLED') return analysisRunFromRow(existing);
      const now = new Date().toISOString();
      const [cancelled] = await transaction.update(analysisRuns).set({ status: 'CANCELLED', cancelledAt: now, updatedAt: now })
        .where(eq(analysisRuns.id, runId)).returning();
      if (cancelled === undefined) throw new AnalysisRunNotFoundError('Analysis run was not found');
      await transaction.insert(auditEvents).values({
        id: `AUDIT-${randomUUID()}`, organizationId: scope.organizationId, actorUserId,
        action: 'PROJECT_ANALYSIS_CANCELLED', targetType: 'AnalysisRun', targetId: runId, requestId,
        metadata: { projectId }
      });
      return analysisRunFromRow(cancelled);
    });
  }
}
