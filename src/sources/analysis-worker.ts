import { createHash, randomUUID } from 'node:crypto';

import { and, asc, eq, sql } from 'drizzle-orm';

import type { AxiomDatabase } from '../database/client';
import { analysisRuns, auditEvents, clarificationQuestions, knowledgeEntities, projectGaps, projectGraphs, projectSources, projects } from '../database/schema';
import { compileGroundedAnalysis } from './grounded-analysis.compiler';

function snapshotHash(sources: ReadonlyArray<{ id: string; sha256: string; version: number }>): string {
  return createHash('sha256').update(JSON.stringify(sources), 'utf8').digest('hex');
}

function safeFailure(cause: unknown): { code: string; message: string } {
  if (cause instanceof Error && cause.message === 'SOURCE_SNAPSHOT_CHANGED') return { code: 'SOURCE_SNAPSHOT_CHANGED', message: 'Project sources changed after this analysis was queued; queue a new run.' };
  return { code: 'ANALYSIS_FAILED', message: 'Analysis failed. Retry with a new idempotency key or inspect local worker logs.' };
}

export class AnalysisWorker {
  constructor(private readonly database: AxiomDatabase, private readonly workerId: string) {}

  async processNext(): Promise<boolean> {
    const leased = await this.database.transaction(async (transaction) => {
      const [candidate] = await transaction.select().from(analysisRuns).where(eq(analysisRuns.status, 'QUEUED'))
        .orderBy(asc(analysisRuns.createdAt), asc(analysisRuns.id)).limit(1).for('update', { skipLocked: true });
      if (candidate === undefined) return null;
      const now = new Date().toISOString();
      const [run] = await transaction.update(analysisRuns).set({
        status: 'RUNNING', attempts: sql`${analysisRuns.attempts} + 1`, lockedBy: this.workerId,
        lockedAt: now, startedAt: now, updatedAt: now
      }).where(and(eq(analysisRuns.id, candidate.id), eq(analysisRuns.status, 'QUEUED'))).returning();
      return run ?? null;
    });
    if (leased === null) return false;

    try {
      const sources = await this.database.select({
        id: projectSources.id, name: projectSources.name, extractedText: projectSources.extractedText,
        sha256: projectSources.sha256, version: projectSources.version
      }).from(projectSources).where(and(
        eq(projectSources.organizationId, leased.organizationId), eq(projectSources.projectId, leased.projectId), eq(projectSources.status, 'EXTRACTED')
      )).orderBy(asc(projectSources.id));
      if (sources.length === 0 || snapshotHash(sources.map(({ id, sha256, version }) => ({ id, sha256, version }))) !== leased.sourceSnapshotHash) {
        throw new Error('SOURCE_SNAPSHOT_CHANGED');
      }
      const [project] = await this.database.select({ name: projects.name }).from(projects).where(and(
        eq(projects.organizationId, leased.organizationId), eq(projects.id, leased.projectId)
      )).limit(1);
      if (project === undefined) throw new Error('PROJECT_NOT_FOUND');
      const analyzedAt = new Date().toISOString();
      const compiled = compileGroundedAnalysis({ projectId: leased.projectId, projectName: project.name, sources, analyzedAt });

      await this.database.transaction(async (transaction) => {
        const [run] = await transaction.select().from(analysisRuns).where(eq(analysisRuns.id, leased.id)).limit(1).for('update');
        if (run === undefined || run.status !== 'RUNNING' || run.lockedBy !== this.workerId) return;
        const currentSources = await transaction.select({ id: projectSources.id, sha256: projectSources.sha256, version: projectSources.version })
          .from(projectSources).where(and(eq(projectSources.organizationId, leased.organizationId), eq(projectSources.projectId, leased.projectId), eq(projectSources.status, 'EXTRACTED'))).orderBy(asc(projectSources.id));
        if (snapshotHash(currentSources) !== leased.sourceSnapshotHash) throw new Error('SOURCE_SNAPSHOT_CHANGED');
        const [lockedProject] = await transaction.select({ graphVersion: projects.graphVersion, status: projects.status }).from(projects)
          .where(and(eq(projects.organizationId, leased.organizationId), eq(projects.id, leased.projectId))).limit(1).for('update');
        if (lockedProject === undefined || lockedProject.status === 'ARCHIVED') throw new Error('PROJECT_NOT_AVAILABLE');
        const graphVersion = lockedProject.graphVersion + 1;
        await transaction.insert(projectGraphs).values({
          organizationId: leased.organizationId, projectId: leased.projectId, graphVersion,
          summary: compiled.summary, readiness: compiled.readiness, analyzer: leased.analyzer, analyzedAt
        });
        if (compiled.entities.length > 0) await transaction.insert(knowledgeEntities).values(compiled.entities.map((entity, position) => ({
          ...entity, organizationId: leased.organizationId, projectId: leased.projectId, graphVersion, position
        })));
        if (compiled.gaps.length > 0) await transaction.insert(projectGaps).values(compiled.gaps.map((gap, position) => ({
          ...gap, organizationId: leased.organizationId, projectId: leased.projectId, graphVersion, position
        })));
        if (compiled.clarificationQuestions.length > 0) await transaction.insert(clarificationQuestions).values(compiled.clarificationQuestions.map((question, position) => ({
          ...question, organizationId: leased.organizationId, projectId: leased.projectId, graphVersion, position
        })));
        await transaction.update(projects).set({
          graphVersion, status: compiled.gaps.length > 0 ? 'NEEDS_CLARIFICATION' : 'ANALYZED',
          rowVersion: sql`${projects.rowVersion} + 1`, updatedAt: analyzedAt
        }).where(and(eq(projects.organizationId, leased.organizationId), eq(projects.id, leased.projectId)));
        await transaction.update(analysisRuns).set({ status: 'SUCCEEDED', graphVersion, completedAt: analyzedAt, lockedBy: null, lockedAt: null, updatedAt: analyzedAt })
          .where(eq(analysisRuns.id, leased.id));
        await transaction.insert(auditEvents).values({
          id: `AUDIT-${randomUUID()}`, organizationId: leased.organizationId, actorUserId: leased.requestedByUserId,
          action: 'PROJECT_ANALYSIS_SUCCEEDED', targetType: 'AnalysisRun', targetId: leased.id,
          requestId: leased.requestId,
          metadata: { projectId: leased.projectId, graphVersion, sourceSnapshotHash: leased.sourceSnapshotHash }
        });
      });
    } catch (cause) {
      const failure = safeFailure(cause);
      const failedAt = new Date().toISOString();
      await this.database.update(analysisRuns).set({
        status: 'FAILED', errorCode: failure.code, errorMessage: failure.message,
        completedAt: failedAt, lockedBy: null, lockedAt: null, updatedAt: failedAt
      }).where(and(eq(analysisRuns.id, leased.id), eq(analysisRuns.status, 'RUNNING'), eq(analysisRuns.lockedBy, this.workerId)));
    }
    return true;
  }
}
