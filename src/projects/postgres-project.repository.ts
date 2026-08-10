import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, lt, or, sql, type SQL } from 'drizzle-orm';

import { DATABASE } from '../database/database.module';
import type { AxiomDatabase } from '../database/client';
import {
  claimPostgresIdempotency,
  completePostgresIdempotency
} from '../database/idempotency/postgres-idempotency';
import { auditEvents, projectGraphs, projects, workspaces } from '../database/schema';
import { ProjectReadinessResponseSchema, ProjectResponseSchema, WorkspaceResponseSchema } from './project.schema';
import { transitionProjectLifecycle } from './project.lifecycle';
import {
  IdempotencyConflictError,
  ProjectCreationInProgressError,
  ProjectNotFoundError,
  ProjectVersionConflictError,
  WorkspaceNotFoundError,
  type ProjectCreationInput,
  type ProjectLifecycleInput,
  type ProjectPage,
  type ProjectPageRequest,
  type ProjectRepository,
  type ProjectScope,
  type WorkspacePage,
  type WorkspacePageRequest
} from './project.repository';

type ProjectReadRow = Pick<
  typeof projects.$inferSelect,
  | 'id'
  | 'workspaceId'
  | 'name'
  | 'status'
  | 'graphVersion'
  | 'rowVersion'
  | 'archivedAt'
  | 'createdAt'
  | 'updatedAt'
>;

function projectFromRow(project: ProjectReadRow) {
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

type WorkspaceReadRow = Pick<
  typeof workspaces.$inferSelect,
  'id' | 'name' | 'rowVersion' | 'createdAt' | 'updatedAt'
>;

function workspaceFromRow(workspace: WorkspaceReadRow) {
  return WorkspaceResponseSchema.parse({
    id: workspace.id,
    name: workspace.name,
    rowVersion: workspace.rowVersion,
    createdAt: new Date(workspace.createdAt).toISOString(),
    updatedAt: new Date(workspace.updatedAt).toISOString()
  });
}

@Injectable()
export class PostgresProjectRepository implements ProjectRepository {
  constructor(@Inject(DATABASE) private readonly database: AxiomDatabase) {}

  async listWorkspaces(scope: ProjectScope, request: WorkspacePageRequest): Promise<WorkspacePage> {
    const filters: SQL[] = [eq(workspaces.organizationId, scope.organizationId)];
    if (request.cursor !== undefined) {
      filters.push(
        or(
          lt(workspaces.updatedAt, request.cursor.updatedAt),
          and(eq(workspaces.updatedAt, request.cursor.updatedAt), lt(workspaces.id, request.cursor.id))
        )!
      );
    }

    const rows = await this.database
      .select({
        id: workspaces.id,
        name: workspaces.name,
        rowVersion: workspaces.rowVersion,
        createdAt: workspaces.createdAt,
        updatedAt: workspaces.updatedAt
      })
      .from(workspaces)
      .where(and(...filters))
      .orderBy(desc(workspaces.updatedAt), desc(workspaces.id))
      .limit(request.limit + 1);

    return {
      workspaces: rows.slice(0, request.limit).map(workspaceFromRow),
      hasNextPage: rows.length > request.limit
    };
  }

  async listProjects(scope: ProjectScope, request: ProjectPageRequest): Promise<ProjectPage> {
    const filters: SQL[] = [eq(projects.organizationId, scope.organizationId)];

    if (request.workspaceId !== undefined) {
      filters.push(eq(projects.workspaceId, request.workspaceId));
    }
    if (request.cursor !== undefined) {
      filters.push(
        or(
          lt(projects.updatedAt, request.cursor.updatedAt),
          and(eq(projects.updatedAt, request.cursor.updatedAt), lt(projects.id, request.cursor.id))
        )!
      );
    }

    const rows = await this.database
      .select({
        id: projects.id,
        workspaceId: projects.workspaceId,
        name: projects.name,
        status: projects.status,
        graphVersion: projects.graphVersion,
        rowVersion: projects.rowVersion,
        archivedAt: projects.archivedAt,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt
      })
      .from(projects)
      .where(and(...filters))
      .orderBy(desc(projects.updatedAt), desc(projects.id))
      .limit(request.limit + 1);

    return {
      projects: rows.slice(0, request.limit).map(projectFromRow),
      hasNextPage: rows.length > request.limit
    };
  }

  async findProject(scope: ProjectScope, projectId: string) {
    const [project] = await this.database
      .select({
        id: projects.id,
        workspaceId: projects.workspaceId,
        name: projects.name,
        status: projects.status,
        graphVersion: projects.graphVersion,
        rowVersion: projects.rowVersion,
        archivedAt: projects.archivedAt,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt
      })
      .from(projects)
      .where(and(eq(projects.organizationId, scope.organizationId), eq(projects.id, projectId)))
      .limit(1);

    return project === undefined ? null : projectFromRow(project);
  }

  async findProjectReadiness(scope: ProjectScope, projectId: string) {
    const [project] = await this.database.select({ id: projects.id, graphVersion: projects.graphVersion })
      .from(projects)
      .where(and(eq(projects.organizationId, scope.organizationId), eq(projects.id, projectId)))
      .limit(1);
    if (project === undefined) return null;
    if (project.graphVersion < 1) return ProjectReadinessResponseSchema.parse({ projectId: project.id, graphVersion: project.graphVersion, readiness: null });
    const [graph] = await this.database.select({ readiness: projectGraphs.readiness })
      .from(projectGraphs)
      .where(and(
        eq(projectGraphs.organizationId, scope.organizationId),
        eq(projectGraphs.projectId, projectId),
        eq(projectGraphs.graphVersion, project.graphVersion)
      ))
      .limit(1);
    return ProjectReadinessResponseSchema.parse({
      projectId: project.id,
      graphVersion: project.graphVersion,
      readiness: graph?.readiness ?? null
    });
  }

  async createProject(scope: ProjectScope, input: ProjectCreationInput) {
    return this.database.transaction(async (transaction) => {
      const reservation = await claimPostgresIdempotency(transaction, {
        organizationId: scope.organizationId,
        scope: 'PROJECT_CREATE',
        key: input.idempotencyKey,
        requestHash: input.requestHash
      });
      if (reservation.kind === 'HASH_CONFLICT') throw new IdempotencyConflictError();
      if (reservation.kind === 'REPLAY') {
        return { project: ProjectResponseSchema.parse(reservation.responsePayload), replayed: true };
      }
      if (reservation.kind === 'IN_PROGRESS') throw new ProjectCreationInProgressError();

      const [workspace] = await transaction
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(and(eq(workspaces.organizationId, scope.organizationId), eq(workspaces.id, input.workspaceId)))
        .limit(1);
      if (workspace === undefined) throw new WorkspaceNotFoundError();

      const [created] = await transaction
        .insert(projects)
        .values({
          id: input.id,
          organizationId: scope.organizationId,
          workspaceId: input.workspaceId,
          name: input.name,
          status: 'DRAFT',
          graphVersion: 0
        })
        .returning({
          id: projects.id,
          workspaceId: projects.workspaceId,
          name: projects.name,
          status: projects.status,
          graphVersion: projects.graphVersion,
          rowVersion: projects.rowVersion,
          archivedAt: projects.archivedAt,
          createdAt: projects.createdAt,
          updatedAt: projects.updatedAt
        });
      if (created === undefined) throw new Error('Project insert did not return a row');

      const project = projectFromRow(created);
      await transaction.insert(auditEvents).values({
        id: `AUDIT-${randomUUID()}`,
        organizationId: scope.organizationId,
        actorUserId: input.actorUserId,
        action: 'PROJECT_CREATED',
        targetType: 'Project',
        targetId: project.id,
        requestId: input.requestId,
        metadata: {
          workspaceId: input.workspaceId,
          rowVersion: project.rowVersion,
          sessionId: input.sessionId
        }
      });
      await completePostgresIdempotency(transaction, {
        recordId: reservation.recordId,
        responseStatus: 201,
        responsePayload: project,
        completedAt: new Date().toISOString()
      });

      return { project, replayed: false };
    });
  }

  async changeProjectLifecycle(scope: ProjectScope, input: ProjectLifecycleInput) {
    return this.database.transaction(async (transaction) => {
      const [current] = await transaction
        .select({
          id: projects.id,
          status: projects.status,
          archivedFromStatus: projects.archivedFromStatus,
          archivedAt: projects.archivedAt,
          rowVersion: projects.rowVersion
        })
        .from(projects)
        .where(and(eq(projects.organizationId, scope.organizationId), eq(projects.id, input.projectId)))
        .limit(1)
        .for('update');

      if (current === undefined) throw new ProjectNotFoundError();
      if (current.rowVersion !== input.expectedRowVersion) throw new ProjectVersionConflictError();

      const occurredAt = new Date().toISOString();
      const next = transitionProjectLifecycle(
        {
          status: current.status,
          archivedFromStatus: current.archivedFromStatus,
          archivedAt: current.archivedAt === null ? null : new Date(current.archivedAt).toISOString()
        },
        input.action,
        occurredAt
      );
      const [updated] = await transaction
        .update(projects)
        .set({
          status: next.status,
          archivedFromStatus: next.archivedFromStatus,
          archivedAt: next.archivedAt,
          rowVersion: sql`${projects.rowVersion} + 1`,
          updatedAt: occurredAt
        })
        .where(
          and(
            eq(projects.organizationId, scope.organizationId),
            eq(projects.id, input.projectId),
            eq(projects.rowVersion, input.expectedRowVersion)
          )
        )
        .returning({
          id: projects.id,
          workspaceId: projects.workspaceId,
          name: projects.name,
          status: projects.status,
          graphVersion: projects.graphVersion,
          rowVersion: projects.rowVersion,
          archivedAt: projects.archivedAt,
          createdAt: projects.createdAt,
          updatedAt: projects.updatedAt
        });
      if (updated === undefined) throw new ProjectVersionConflictError();

      const project = projectFromRow(updated);
      await transaction.insert(auditEvents).values({
        id: `AUDIT-${randomUUID()}`,
        organizationId: scope.organizationId,
        actorUserId: input.actorUserId,
        action: input.action === 'ARCHIVE' ? 'PROJECT_ARCHIVED' : 'PROJECT_RESTORED',
        targetType: 'Project',
        targetId: project.id,
        requestId: input.requestId,
        metadata: {
          previousStatus: current.status,
          status: project.status,
          previousRowVersion: current.rowVersion,
          rowVersion: project.rowVersion,
          sessionId: input.sessionId
        }
      });

      return project;
    });
  }
}
