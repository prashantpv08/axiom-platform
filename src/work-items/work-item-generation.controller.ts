import { Body, Controller, Get, Header, Headers, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';

import { requireAccessContext, type AuthenticatedRequest } from '../identity/access/access-context';
import { WORK_ITEM_GENERATE, WORK_ITEM_READ } from '../identity/access/permissions';
import { RequirePermission } from '../identity/access/require-permission.decorator';
import type { WorkItemGenerationPreview } from './work-item-generation.schema';
import { WorkItemGenerationService } from './work-item-generation.service';

@ApiTags('work-items')
@ApiBearerAuth('session-bearer')
@ApiCookieAuth('session-cookie')
@Controller('organizations/:organizationId/projects/:projectId/work-item-generations')
export class WorkItemGenerationController {
  constructor(@Inject(WorkItemGenerationService) private readonly service: WorkItemGenerationService) {}

  @Get('latest')
  @Header('Cache-Control', 'no-store')
  @RequirePermission(WORK_ITEM_READ)
  @ApiOperation({ operationId: 'getLatestWorkItemGeneration', summary: 'Read the latest exact work-item preview' })
  latest(@Req() request: AuthenticatedRequest, @Param('projectId') projectId: string) {
    return this.service.latest(requireAccessContext(request), projectId);
  }

  @Post()
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @RequirePermission(WORK_ITEM_GENERATE)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ operationId: 'generateWorkItemDraft', summary: 'Route, generate, validate, and persist a governed backlog draft' })
  async generate(
    @Req() request: AuthenticatedRequest,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: unknown,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<WorkItemGenerationPreview> {
    const preview = await this.service.generate(requireAccessContext(request), projectId, body, idempotencyKey, request.id);
    void reply.header('Idempotency-Replayed', String(preview.replayed));
    void reply.header('ETag', `"${preview.id}:${preview.contentHash}"`);
    return preview;
  }
}
