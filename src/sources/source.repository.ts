import type { AnalysisRunResponse, SourceResponse } from './source.schema';

export const SOURCE_REPOSITORY = Symbol('AXIOM_SOURCE_REPOSITORY');

export type SourceScope = Readonly<{ organizationId: string }>;

export class SourceProjectNotFoundError extends Error {}
export class SourceProjectArchivedError extends Error {}
export class SourceIdempotencyConflictError extends Error {}
export class AnalysisAlreadyActiveError extends Error {}
export class AnalysisSourcesUnavailableError extends Error {}
export class AnalysisRunNotFoundError extends Error {}

export interface SourceRepository {
  projectIdentity(scope: SourceScope, projectId: string): Promise<{ workspaceId: string; status: string } | null>;
  list(scope: SourceScope, projectId: string): Promise<SourceResponse[] | null>;
  create(scope: SourceScope, input: {
    source: Omit<SourceResponse, 'version'>;
    extractedText: string;
    actorUserId: string;
    idempotencyKey: string;
    requestHash: string;
    requestId: string;
  }): Promise<{ source: SourceResponse; replayed: boolean }>;
  queueAnalysis(scope: SourceScope, input: {
    projectId: string;
    runId: string;
    actorUserId: string;
    analyzer: 'axiom-deterministic-grounded-v1';
    idempotencyKey: string;
    requestHash: string;
    requestId: string;
  }): Promise<{ run: AnalysisRunResponse; replayed: boolean }>;
  findAnalysisRun(scope: SourceScope, projectId: string, runId: string): Promise<AnalysisRunResponse | null>;
  latestAnalysisRun(scope: SourceScope, projectId: string): Promise<AnalysisRunResponse | null>;
  cancelAnalysisRun(scope: SourceScope, projectId: string, runId: string, actorUserId: string, requestId: string): Promise<AnalysisRunResponse | null>;
}
