import { Body, Controller, Get, Header, Headers, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';

import { requireAccessContext, type AuthenticatedRequest } from '../identity/access/access-context';
import { ANALYSIS_RUN, PROJECT_READ, SOURCE_MANAGE } from '../identity/access/permissions';
import { RequirePermission } from '../identity/access/require-permission.decorator';
import { SourceService } from './source.service';

@ApiTags('sources', 'analysis')
@ApiBearerAuth('session-bearer')
@ApiCookieAuth('session-cookie')
@Controller('organizations/:organizationId/projects/:projectId')
export class SourceController {
  constructor(@Inject(SourceService) private readonly service: SourceService) {}

  @Get('sources')
  @Header('Cache-Control', 'no-store')
  @RequirePermission(PROJECT_READ)
  @ApiOperation({ operationId: 'listProjectSources', summary: 'List immutable source versions for a project' })
  @ApiParam({ name: 'organizationId' })
  @ApiParam({ name: 'projectId' })
  list(@Req() request: AuthenticatedRequest, @Param('projectId') projectId: string) {
    return this.service.list(requireAccessContext(request), projectId);
  }

  @Post('sources')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @RequirePermission(SOURCE_MANAGE)
  @ApiOperation({ operationId: 'uploadProjectSource', summary: 'Validate, store, extract, and version one bounded source' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async upload(
    @Req() request: AuthenticatedRequest,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: unknown,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    const result = await this.service.upload(requireAccessContext(request), projectId, body, idempotencyKey, request.id);
    void reply.header('Idempotency-Replayed', String(result.replayed));
    return result.source;
  }

  @Post('analysis-runs')
  @HttpCode(202)
  @Header('Cache-Control', 'no-store')
  @RequirePermission(ANALYSIS_RUN)
  @ApiOperation({ operationId: 'queueProjectAnalysis', summary: 'Queue durable source-grounded project analysis' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  async queue(
    @Req() request: AuthenticatedRequest,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: unknown,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    const result = await this.service.queueAnalysis(requireAccessContext(request), projectId, body, idempotencyKey, request.id);
    void reply.header('Idempotency-Replayed', String(result.replayed));
    return result.run;
  }

  @Get('analysis-runs/:runId')
  @Header('Cache-Control', 'no-store')
  @RequirePermission(PROJECT_READ)
  @ApiOperation({ operationId: 'getProjectAnalysisRun', summary: 'Read an honest durable analysis state' })
  getRun(@Req() request: AuthenticatedRequest, @Param('projectId') projectId: string, @Param('runId') runId: string) {
    return this.service.getAnalysisRun(requireAccessContext(request), projectId, runId);
  }

  @Get('analysis-runs')
  @Header('Cache-Control', 'no-store')
  @RequirePermission(PROJECT_READ)
  @ApiOperation({ operationId: 'getLatestProjectAnalysisRun', summary: 'Read the latest durable analysis state when one exists' })
  getLatestRun(@Req() request: AuthenticatedRequest, @Param('projectId') projectId: string) {
    return this.service.getLatestAnalysisRun(requireAccessContext(request), projectId);
  }

  @Post('analysis-runs/:runId/cancel')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @RequirePermission(ANALYSIS_RUN)
  @ApiOperation({ operationId: 'cancelProjectAnalysisRun', summary: 'Cancel queued or running analysis' })
  cancel(@Req() request: AuthenticatedRequest, @Param('projectId') projectId: string, @Param('runId') runId: string) {
    return this.service.cancelAnalysisRun(requireAccessContext(request), projectId, runId, request.id);
  }
}
