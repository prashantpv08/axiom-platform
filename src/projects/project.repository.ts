import type { ProjectCursor, ProjectReadinessResponse, ProjectResponse, WorkspaceCursor, WorkspaceResponse } from './project.schema';
import type { ProjectLifecycleAction } from './project.lifecycle';

export const PROJECT_REPOSITORY = Symbol('AXIOM_PROJECT_REPOSITORY');

export type ProjectScope = Readonly<{ organizationId: string }>;

export type ProjectPageRequest = {
  cursor?: ProjectCursor;
  limit: number;
  workspaceId?: string;
};

export type ProjectPage = {
  projects: ProjectResponse[];
  hasNextPage: boolean;
};

export type WorkspacePageRequest = {
  cursor?: WorkspaceCursor;
  limit: number;
};

export type WorkspacePage = {
  workspaces: WorkspaceResponse[];
  hasNextPage: boolean;
};

export type ProjectCreationInput = {
  id: string;
  workspaceId: string;
  name: string;
  idempotencyKey: string;
  requestHash: string;
  actorUserId: string;
  sessionId: string;
  requestId: string;
};

export type ProjectCreationResult = {
  project: ProjectResponse;
  replayed: boolean;
};

export type ProjectLifecycleInput = {
  projectId: string;
  action: ProjectLifecycleAction;
  expectedRowVersion: number;
  actorUserId: string;
  sessionId: string;
  requestId: string;
};

export class IdempotencyConflictError extends Error {
  constructor() {
    super('Idempotency key was already used for a different request');
    this.name = 'IdempotencyConflictError';
  }
}

export class ProjectCreationInProgressError extends Error {
  constructor() {
    super('Project creation with this idempotency key is still processing');
    this.name = 'ProjectCreationInProgressError';
  }
}

export class WorkspaceNotFoundError extends Error {
  constructor() {
    super('Workspace was not found');
    this.name = 'WorkspaceNotFoundError';
  }
}

export class ProjectNotFoundError extends Error {
  constructor() {
    super('Project was not found');
    this.name = 'ProjectNotFoundError';
  }
}

export class ProjectVersionConflictError extends Error {
  constructor() {
    super('Project has changed since it was loaded');
    this.name = 'ProjectVersionConflictError';
  }
}

export interface ProjectRepository {
  listWorkspaces(scope: ProjectScope, request: WorkspacePageRequest): Promise<WorkspacePage>;
  listProjects(scope: ProjectScope, request: ProjectPageRequest): Promise<ProjectPage>;
  findProject(scope: ProjectScope, projectId: string): Promise<ProjectResponse | null>;
  findProjectReadiness(scope: ProjectScope, projectId: string): Promise<ProjectReadinessResponse | null>;
  createProject(scope: ProjectScope, input: ProjectCreationInput): Promise<ProjectCreationResult>;
  changeProjectLifecycle(scope: ProjectScope, input: ProjectLifecycleInput): Promise<ProjectResponse>;
}
