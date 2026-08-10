import { Body, Controller, Get, Header, Headers, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';

import { requireAccessContext, type AuthenticatedRequest } from '../identity/access/access-context';
import { ARTIFACT_APPROVE, ARTIFACT_GENERATE, PROJECT_READ } from '../identity/access/permissions';
import { RequirePermission } from '../identity/access/require-permission.decorator';
import { formatStrongEntityTag } from '../platform/http/entity-tag';
import { parseProjectVersionPrecondition } from '../projects/project-http';
import { ArtifactService } from './artifact.service';

@ApiTags('artifacts')
@ApiBearerAuth('session-bearer')
@ApiCookieAuth('session-cookie')
@Controller('organizations/:organizationId/projects/:projectId/artifacts')
export class ArtifactController {
  constructor(@Inject(ArtifactService) private readonly service: ArtifactService) {}

  @Get('current')
  @Header('Cache-Control', 'no-store')
  @RequirePermission(PROJECT_READ)
  @ApiOperation({ operationId: 'getCurrentArtifactBaseline', summary: 'Read exact current-graph requirement artifacts and approval' })
  current(@Req() request: AuthenticatedRequest, @Param('projectId') projectId: string) {
    return this.service.current(requireAccessContext(request), projectId);
  }

  @Post('generations')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @RequirePermission(ARTIFACT_GENERATE)
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ operationId: 'generateRequirementBaseline', summary: 'Compile and persist versioned current-graph requirement artifacts' })
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

  @Post('approvals')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @RequirePermission(ARTIFACT_APPROVE)
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ operationId: 'approveRequirementBaseline', summary: 'Approve the exact current-graph requirement artifact hashes' })
  async approve(
    @Req() request: AuthenticatedRequest,
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Headers('if-match') ifMatch: unknown,
    @Headers('idempotency-key') idempotencyKey: unknown,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    const precondition = parseProjectVersionPrecondition(projectId, ifMatch);
    const result = await this.service.approve(requireAccessContext(request), precondition.projectId, body, precondition.expectedRowVersion, idempotencyKey, request.id);
    void reply.header('ETag', formatStrongEntityTag(result.project.id, result.project.rowVersion));
    void reply.header('Idempotency-Replayed', String(result.replayed));
    return result;
  }
}
