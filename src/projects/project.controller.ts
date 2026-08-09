import { Body, Controller, Get, Header, Headers, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags
} from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger/dist/interfaces/open-api-spec.interface';
import type { FastifyReply } from 'fastify';

import { requireAccessContext, type AuthenticatedRequest } from '../identity/access/access-context';
import { PROJECT_ARCHIVE, PROJECT_CREATE, PROJECT_READ, PROJECT_RESTORE } from '../identity/access/permissions';
import { RequirePermission } from '../identity/access/require-permission.decorator';
import type { ProjectListResponse, ProjectResponse } from './project.schema';
import { projectEtag, ProjectService } from './project.service';

const projectSchema: SchemaObject = {
  type: 'object',
  required: [
    'id',
    'workspaceId',
    'name',
    'status',
    'graphVersion',
    'rowVersion',
    'archivedAt',
    'createdAt',
    'updatedAt'
  ],
  properties: {
    id: { type: 'string' },
    workspaceId: { type: 'string' },
    name: { type: 'string' },
    status: {
      type: 'string',
      enum: [
        'DRAFT',
        'SOURCES_READY',
        'ANALYZED',
        'NEEDS_CLARIFICATION',
        'DOCUMENTED',
        'DOCUMENTS_APPROVED',
        'DESIGN_READY',
        'ARB_APPROVED',
        'HLD_READY',
        'PUBLISHED',
        'BACKLOG_READY',
        'ARCHIVED'
      ]
    },
    graphVersion: { type: 'integer', minimum: 0 },
    rowVersion: { type: 'integer', minimum: 1 },
    archivedAt: { anyOf: [{ type: 'string', format: 'date-time' }, { type: 'null' }] },
    createdAt: { type: 'string', format: 'date-time' },
    updatedAt: { type: 'string', format: 'date-time' }
  }
};

@ApiTags('projects')
@ApiBearerAuth('session-bearer')
@ApiCookieAuth('session-cookie')
@RequirePermission(PROJECT_READ)
@Controller('organizations/:organizationId/projects')
export class ProjectController {
  constructor(@Inject(ProjectService) private readonly projectService: ProjectService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'listProjects', summary: 'List projects in an authorized organization' })
  @ApiParam({ name: 'organizationId', example: 'ORG-LOCAL-DEVELOPMENT' })
  @ApiQuery({ name: 'cursor', required: false, type: String })
  @ApiQuery({ name: 'limit', required: false, type: Number, example: 25 })
  @ApiQuery({ name: 'workspaceId', required: false, type: String })
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['projects', 'nextCursor'],
      properties: {
        projects: { type: 'array', items: projectSchema },
        nextCursor: { anyOf: [{ type: 'string' }, { type: 'null' }] }
      }
    }
  })
  listProjects(
    @Req() request: AuthenticatedRequest,
    @Query() query: Record<string, unknown>
  ): Promise<ProjectListResponse> {
    return this.projectService.listProjects(requireAccessContext(request), query);
  }

  @Post()
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @RequirePermission(PROJECT_CREATE)
  @ApiOperation({ operationId: 'createProject', summary: 'Create a project in an authorized organization workspace' })
  @ApiParam({ name: 'organizationId', example: 'ORG-LOCAL-DEVELOPMENT' })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Stable key for safe create retries' })
  @ApiCreatedResponse({ schema: projectSchema })
  async createProject(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: unknown,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<ProjectResponse> {
    const result = await this.projectService.createProject(
      requireAccessContext(request),
      body,
      idempotencyKey,
      request.id
    );
    void reply.header('ETag', projectEtag(result.project));
    void reply.header('Idempotency-Replayed', String(result.replayed));
    return result.project;
  }

  @Post(':projectId/archive')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @RequirePermission(PROJECT_ARCHIVE)
  @ApiOperation({ operationId: 'archiveProject', summary: 'Archive a project at an expected row version' })
  @ApiParam({ name: 'organizationId', example: 'ORG-LOCAL-DEVELOPMENT' })
  @ApiParam({ name: 'projectId', example: 'PROJ-123' })
  @ApiHeader({ name: 'If-Match', required: true, description: 'Strong project ETag returned by a project read' })
  @ApiOkResponse({ schema: projectSchema })
  @ApiResponse({ status: 412, description: 'The project row version changed' })
  @ApiResponse({ status: 428, description: 'The If-Match header is required' })
  async archiveProject(
    @Req() request: AuthenticatedRequest,
    @Param('projectId') projectId: string,
    @Headers('if-match') ifMatch: unknown,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<ProjectResponse> {
    const project = await this.projectService.changeProjectLifecycle(
      requireAccessContext(request),
      projectId,
      ifMatch,
      request.id,
      'ARCHIVE'
    );
    void reply.header('ETag', projectEtag(project));
    return project;
  }

  @Post(':projectId/restore')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @RequirePermission(PROJECT_RESTORE)
  @ApiOperation({ operationId: 'restoreProject', summary: 'Restore a project at an expected row version' })
  @ApiParam({ name: 'organizationId', example: 'ORG-LOCAL-DEVELOPMENT' })
  @ApiParam({ name: 'projectId', example: 'PROJ-123' })
  @ApiHeader({ name: 'If-Match', required: true, description: 'Strong project ETag returned by a project read' })
  @ApiOkResponse({ schema: projectSchema })
  @ApiResponse({ status: 412, description: 'The project row version changed' })
  @ApiResponse({ status: 428, description: 'The If-Match header is required' })
  async restoreProject(
    @Req() request: AuthenticatedRequest,
    @Param('projectId') projectId: string,
    @Headers('if-match') ifMatch: unknown,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<ProjectResponse> {
    const project = await this.projectService.changeProjectLifecycle(
      requireAccessContext(request),
      projectId,
      ifMatch,
      request.id,
      'RESTORE'
    );
    void reply.header('ETag', projectEtag(project));
    return project;
  }

  @Get(':projectId')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'getProject', summary: 'Get project metadata in an authorized organization' })
  @ApiParam({ name: 'organizationId', example: 'ORG-LOCAL-DEVELOPMENT' })
  @ApiParam({ name: 'projectId', example: 'PROJ-123' })
  @ApiOkResponse({ schema: projectSchema })
  @ApiNotFoundResponse({ description: 'The scoped project was not found' })
  async getProject(
    @Req() request: AuthenticatedRequest,
    @Param('projectId') projectId: string,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<ProjectResponse> {
    const project = await this.projectService.getProject(requireAccessContext(request), projectId);
    void reply.header('ETag', projectEtag(project));
    return project;
  }

  @Get(':projectId/readiness')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'getProjectReadiness', summary: 'Read the deterministic current-graph readiness calculation' })
  @ApiParam({ name: 'organizationId', example: 'ORG-LOCAL-DEVELOPMENT' })
  @ApiParam({ name: 'projectId', example: 'PROJ-123' })
  @ApiOkResponse({ description: 'Current graph readiness or an explicit null when no calculation exists' })
  @ApiNotFoundResponse({ description: 'The scoped project was not found' })
  getProjectReadiness(
    @Req() request: AuthenticatedRequest,
    @Param('projectId') projectId: string
  ) {
    return this.projectService.getProjectReadiness(requireAccessContext(request), projectId);
  }
}
