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
import type { FastifyReply } from 'fastify';

import { requireAccessContext, type AuthenticatedRequest } from '../identity/access/access-context';
import { PROJECT_ARCHIVE, PROJECT_CREATE, PROJECT_READ, PROJECT_RESTORE } from '../identity/access/permissions';
import { RequirePermission } from '../identity/access/require-permission.decorator';
import { formatStrongEntityTag } from '../platform/http/entity-tag';
import { parseProjectVersionPrecondition } from './project-http';
import type { ProjectListResponse, ProjectResponse } from './project.schema';
import { ProjectService } from './project.service';

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
  @ApiOkResponse({ description: 'Authorized organization projects' })
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
  @ApiCreatedResponse({ description: 'Created project' })
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
    void reply.header('ETag', formatStrongEntityTag(result.project.id, result.project.rowVersion));
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
  @ApiOkResponse({ description: 'Current project' })
  @ApiResponse({ status: 412, description: 'The project row version changed' })
  @ApiResponse({ status: 428, description: 'The If-Match header is required' })
  async archiveProject(
    @Req() request: AuthenticatedRequest,
    @Param('projectId') projectId: string,
    @Headers('if-match') ifMatch: unknown,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<ProjectResponse> {
    const precondition = parseProjectVersionPrecondition(projectId, ifMatch);
    const project = await this.projectService.changeProjectLifecycle(
      requireAccessContext(request),
      precondition.projectId,
      precondition.expectedRowVersion,
      request.id,
      'ARCHIVE'
    );
    void reply.header('ETag', formatStrongEntityTag(project.id, project.rowVersion));
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
  @ApiOkResponse({ description: 'Current project' })
  @ApiResponse({ status: 412, description: 'The project row version changed' })
  @ApiResponse({ status: 428, description: 'The If-Match header is required' })
  async restoreProject(
    @Req() request: AuthenticatedRequest,
    @Param('projectId') projectId: string,
    @Headers('if-match') ifMatch: unknown,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<ProjectResponse> {
    const precondition = parseProjectVersionPrecondition(projectId, ifMatch);
    const project = await this.projectService.changeProjectLifecycle(
      requireAccessContext(request),
      precondition.projectId,
      precondition.expectedRowVersion,
      request.id,
      'RESTORE'
    );
    void reply.header('ETag', formatStrongEntityTag(project.id, project.rowVersion));
    return project;
  }

  @Get(':projectId')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'getProject', summary: 'Get project metadata in an authorized organization' })
  @ApiParam({ name: 'organizationId', example: 'ORG-LOCAL-DEVELOPMENT' })
  @ApiParam({ name: 'projectId', example: 'PROJ-123' })
  @ApiOkResponse({ description: 'Current project' })
  @ApiNotFoundResponse({ description: 'The scoped project was not found' })
  async getProject(
    @Req() request: AuthenticatedRequest,
    @Param('projectId') projectId: string,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<ProjectResponse> {
    const project = await this.projectService.getProject(requireAccessContext(request), projectId);
    void reply.header('ETag', formatStrongEntityTag(project.id, project.rowVersion));
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
