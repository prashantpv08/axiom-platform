import { createHash, randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException
} from '@nestjs/common';

import type { OrganizationAccessContext } from '../identity/identity.schema';
import {
  CreateProjectRequestSchema,
  IdempotencyKeySchema,
  ProjectCursorSchema,
  ProjectIdSchema,
  ProjectListQuerySchema,
  ProjectListResponseSchema,
  ProjectReadinessResponseSchema,
  ProjectResponseSchema,
  WorkspaceCursorSchema,
  WorkspaceListQuerySchema,
  WorkspaceListResponseSchema,
  type ProjectCursor,
  type ProjectListResponse,
  type ProjectResponse,
  type WorkspaceCursor,
  type WorkspaceListResponse
} from './project.schema';
import {
  IdempotencyConflictError,
  PROJECT_REPOSITORY,
  ProjectCreationInProgressError,
  WorkspaceNotFoundError,
  ProjectNotFoundError,
  ProjectVersionConflictError,
  type ProjectRepository
} from './project.repository';
import { ProjectLifecycleConflictError, type ProjectLifecycleAction } from './project.lifecycle';

export function encodeProjectCursor(cursor: ProjectCursor): string {
  return Buffer.from(JSON.stringify(ProjectCursorSchema.parse(cursor)), 'utf8').toString('base64url');
}

function decodeProjectCursor(value: string): ProjectCursor {
  try {
    return ProjectCursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
  } catch {
    throw new BadRequestException('Project cursor is invalid');
  }
}

function encodeWorkspaceCursor(cursor: WorkspaceCursor): string {
  return Buffer.from(JSON.stringify(WorkspaceCursorSchema.parse(cursor)), 'utf8').toString('base64url');
}

function decodeWorkspaceCursor(value: string): WorkspaceCursor {
  try {
    return WorkspaceCursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
  } catch {
    throw new BadRequestException('Workspace cursor is invalid');
  }
}

export function projectEtag(project: Pick<ProjectResponse, 'id' | 'rowVersion'>): string {
  return `"${project.id}:${project.rowVersion}"`;
}

export function expectedProjectRowVersion(value: unknown, projectId: string): number {
  if (value === undefined) throw new HttpException('If-Match header is required', 428);
  if (typeof value !== 'string') throw new BadRequestException('If-Match header is invalid for this project');

  const match = /^"(PROJ-[A-Za-z0-9_-]{1,123}):([1-9][0-9]*)"$/u.exec(value);
  if (match === null || match[1] !== projectId) {
    throw new BadRequestException('If-Match header is invalid for this project');
  }
  const rowVersion = Number(match[2]);
  if (!Number.isSafeInteger(rowVersion)) throw new BadRequestException('If-Match header is invalid for this project');
  return rowVersion;
}

@Injectable()
export class ProjectService {
  constructor(@Inject(PROJECT_REPOSITORY) private readonly repository: ProjectRepository) {}

  async listWorkspaces(context: OrganizationAccessContext, input: unknown): Promise<WorkspaceListResponse> {
    const query = WorkspaceListQuerySchema.safeParse(input);
    if (!query.success) throw new BadRequestException('Workspace list query is invalid');

    const page = await this.repository.listWorkspaces(
      { organizationId: context.organizationId },
      {
        limit: query.data.limit,
        ...(query.data.cursor === undefined ? {} : { cursor: decodeWorkspaceCursor(query.data.cursor) })
      }
    );
    const lastWorkspace = page.workspaces.at(-1);

    return WorkspaceListResponseSchema.parse({
      workspaces: page.workspaces,
      nextCursor:
        page.hasNextPage && lastWorkspace !== undefined
          ? encodeWorkspaceCursor({ id: lastWorkspace.id, updatedAt: lastWorkspace.updatedAt })
          : null
    });
  }

  async listProjects(context: OrganizationAccessContext, input: unknown): Promise<ProjectListResponse> {
    const query = ProjectListQuerySchema.safeParse(input);
    if (!query.success) throw new BadRequestException('Project list query is invalid');

    const page = await this.repository.listProjects(
      { organizationId: context.organizationId },
      {
        limit: query.data.limit,
        ...(query.data.workspaceId === undefined ? {} : { workspaceId: query.data.workspaceId }),
        ...(query.data.cursor === undefined ? {} : { cursor: decodeProjectCursor(query.data.cursor) })
      }
    );
    const lastProject = page.projects.at(-1);

    return ProjectListResponseSchema.parse({
      projects: page.projects,
      nextCursor:
        page.hasNextPage && lastProject !== undefined
          ? encodeProjectCursor({ id: lastProject.id, updatedAt: lastProject.updatedAt })
          : null
    });
  }

  async getProject(context: OrganizationAccessContext, input: unknown): Promise<ProjectResponse> {
    const projectId = ProjectIdSchema.safeParse(input);
    if (!projectId.success) throw new NotFoundException('Project was not found');

    const project = await this.repository.findProject({ organizationId: context.organizationId }, projectId.data);
    if (project === null) throw new NotFoundException('Project was not found');

    return ProjectResponseSchema.parse(project);
  }

  async getProjectReadiness(context: OrganizationAccessContext, input: unknown) {
    const projectId = ProjectIdSchema.safeParse(input);
    if (!projectId.success) throw new NotFoundException('Project was not found');
    const readiness = await this.repository.findProjectReadiness({ organizationId: context.organizationId }, projectId.data);
    if (readiness === null) throw new NotFoundException('Project was not found');
    return ProjectReadinessResponseSchema.parse(readiness);
  }

  async createProject(
    context: OrganizationAccessContext,
    input: unknown,
    idempotencyKeyInput: unknown,
    requestId: string
  ) {
    const request = CreateProjectRequestSchema.safeParse(input);
    if (!request.success) throw new BadRequestException('Project creation request is invalid');
    const idempotencyKey = IdempotencyKeySchema.safeParse(idempotencyKeyInput);
    if (!idempotencyKey.success) throw new BadRequestException('A valid Idempotency-Key header is required');

    const requestHash = createHash('sha256')
      .update(JSON.stringify({ name: request.data.name, workspaceId: request.data.workspaceId }), 'utf8')
      .digest('hex');

    try {
      return await this.repository.createProject(
        { organizationId: context.organizationId },
        {
          id: `PROJ-${randomUUID()}`,
          ...request.data,
          idempotencyKey: idempotencyKey.data,
          requestHash,
          actorUserId: context.userId,
          sessionId: context.sessionId,
          requestId
        }
      );
    } catch (cause) {
      if (cause instanceof WorkspaceNotFoundError) throw new NotFoundException(cause.message);
      if (cause instanceof IdempotencyConflictError || cause instanceof ProjectCreationInProgressError) {
        throw new ConflictException(cause.message);
      }
      throw cause;
    }
  }

  async changeProjectLifecycle(
    context: OrganizationAccessContext,
    projectIdInput: unknown,
    ifMatchInput: unknown,
    requestId: string,
    action: ProjectLifecycleAction
  ): Promise<ProjectResponse> {
    const projectId = ProjectIdSchema.safeParse(projectIdInput);
    if (!projectId.success) throw new NotFoundException('Project was not found');
    const expectedRowVersion = expectedProjectRowVersion(ifMatchInput, projectId.data);

    try {
      return await this.repository.changeProjectLifecycle(
        { organizationId: context.organizationId },
        {
          projectId: projectId.data,
          action,
          expectedRowVersion,
          actorUserId: context.userId,
          sessionId: context.sessionId,
          requestId
        }
      );
    } catch (cause) {
      if (cause instanceof ProjectNotFoundError) throw new NotFoundException(cause.message);
      if (cause instanceof ProjectVersionConflictError) {
        throw new HttpException(cause.message, HttpStatus.PRECONDITION_FAILED);
      }
      if (cause instanceof ProjectLifecycleConflictError) throw new ConflictException(cause.message);
      throw cause;
    }
  }
}
