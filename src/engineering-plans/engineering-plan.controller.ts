import { Body, Controller, Get, Header, Headers, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';

import { requireAccessContext, type AuthenticatedRequest } from '../identity/access/access-context';
import { ENGINEERING_PLAN_GENERATE, PROJECT_READ } from '../identity/access/permissions';
import { RequirePermission } from '../identity/access/require-permission.decorator';
import type { EngineeringPlanPreview } from './engineering-plan.schema';
import { EngineeringPlanService } from './engineering-plan.service';

@ApiTags('engineering-plans')
@ApiBearerAuth('session-bearer')
@ApiCookieAuth('session-cookie')
@Controller('organizations/:organizationId/projects/:projectId/engineering-plans')
export class EngineeringPlanController {
  constructor(@Inject(EngineeringPlanService) private readonly service: EngineeringPlanService) {}

  @Get('latest')
  @Header('Cache-Control', 'no-store')
  @RequirePermission(PROJECT_READ)
  @ApiOperation({ operationId: 'getLatestEngineeringPlan', summary: 'Read the latest evidence-grounded full-lifecycle Engineering Plan' })
  latest(@Req() request: AuthenticatedRequest, @Param('projectId') projectId: string) {
    return this.service.latest(requireAccessContext(request), projectId);
  }

  @Post()
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @RequirePermission(ENGINEERING_PLAN_GENERATE)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ operationId: 'generateEngineeringPlan', summary: 'Generate, evaluate, and persist a complete AI Engineering Plan draft' })
  async generate(
    @Req() request: AuthenticatedRequest,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: unknown,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<EngineeringPlanPreview> {
    const preview = await this.service.generate(requireAccessContext(request), projectId, body, idempotencyKey, request.id);
    void reply.header('Idempotency-Replayed', String(preview.replayed));
    void reply.header('ETag', `"${preview.id}:${preview.contentHash}"`);
    return preview;
  }
}
