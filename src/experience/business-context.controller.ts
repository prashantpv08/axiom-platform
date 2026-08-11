import { Body, Controller, Get, Header, Headers, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';

import { requireAccessContext, type AuthenticatedRequest } from '../identity/access/access-context';
import { EXPERIENCE_GENERATE, EXPERIENCE_REVIEW, PROJECT_READ } from '../identity/access/permissions';
import { RequirePermission } from '../identity/access/require-permission.decorator';
import { formatStrongEntityTag } from '../platform/http/entity-tag';
import { parseProjectVersionPrecondition } from '../projects/project-http';
import { BusinessContextService } from './business-context.service';

@ApiTags('experience')
@ApiBearerAuth('session-bearer')
@ApiCookieAuth('session-cookie')
@Controller('organizations/:organizationId/projects/:projectId/business-context')
export class BusinessContextController {
  constructor(@Inject(BusinessContextService) private readonly service: BusinessContextService) {}

  @Get('preview')
  @Header('Cache-Control', 'no-store')
  @RequirePermission(PROJECT_READ)
  @ApiOperation({ operationId: 'getBusinessContextPreview', summary: 'Compile the current source-linked Business Context and experience-applicability preview' })
  preview(@Req() request: AuthenticatedRequest, @Param('projectId') projectId: string) {
    return this.service.preview(requireAccessContext(request), projectId);
  }

  @Get('current')
  @Header('Cache-Control', 'no-store')
  @RequirePermission(PROJECT_READ)
  @ApiOperation({ operationId: 'getCurrentBusinessContext', summary: 'Read the latest exact Business Context version and review for the current graph' })
  current(@Req() request: AuthenticatedRequest, @Param('projectId') projectId: string) {
    return this.service.current(requireAccessContext(request), projectId);
  }

  @Post('generations')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @RequirePermission(EXPERIENCE_GENERATE)
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ operationId: 'generateBusinessContext', summary: 'Persist the exact current Business Context preview as an immutable version' })
  async generate(
    @Req() request: AuthenticatedRequest,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Headers('if-match') ifMatch: unknown,
    @Headers('idempotency-key') idempotencyKey: unknown,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    const precondition = parseProjectVersionPrecondition(projectId, ifMatch);
    const result = await this.service.generate(requireAccessContext(request), precondition.projectId, body, precondition.expectedRowVersion, idempotencyKey, request.id);
    void reply.header('ETag', formatStrongEntityTag(result.project.id, result.project.rowVersion));
    void reply.header('Idempotency-Replayed', String(result.replayed));
    return result;
  }

  @Post('reviews')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @RequirePermission(EXPERIENCE_REVIEW)
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ operationId: 'reviewBusinessContext', summary: 'Record an exact categorized human review of the latest Business Context version' })
  async review(
    @Req() request: AuthenticatedRequest,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Headers('if-match') ifMatch: unknown,
    @Headers('idempotency-key') idempotencyKey: unknown,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    const precondition = parseProjectVersionPrecondition(projectId, ifMatch);
    const result = await this.service.review(requireAccessContext(request), precondition.projectId, body, precondition.expectedRowVersion, idempotencyKey, request.id);
    void reply.header('ETag', formatStrongEntityTag(result.project.id, result.project.rowVersion));
    void reply.header('Idempotency-Replayed', String(result.replayed));
    return result;
  }

  @Post('applicability-decisions')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @RequirePermission(EXPERIENCE_REVIEW)
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ operationId: 'resolveExperienceApplicability', summary: 'Create a human-confirmed graph version from an exact unresolved experience-applicability preview' })
  async resolveApplicability(
    @Req() request: AuthenticatedRequest,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Headers('if-match') ifMatch: unknown,
    @Headers('idempotency-key') idempotencyKey: unknown,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    const precondition = parseProjectVersionPrecondition(projectId, ifMatch);
    const result = await this.service.resolveApplicability(requireAccessContext(request), precondition.projectId, body, precondition.expectedRowVersion, idempotencyKey, request.id);
    void reply.header('ETag', formatStrongEntityTag(result.project.id, result.project.rowVersion));
    void reply.header('Idempotency-Replayed', String(result.replayed));
    return result;
  }
}
