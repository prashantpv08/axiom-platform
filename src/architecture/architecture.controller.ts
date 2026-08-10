import { Body, Controller, Get, Header, Headers, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';

import { requireAccessContext, type AuthenticatedRequest } from '../identity/access/access-context';
import { ARCHITECTURE_APPROVE, ARCHITECTURE_GENERATE, PROJECT_READ } from '../identity/access/permissions';
import { RequirePermission } from '../identity/access/require-permission.decorator';
import { formatStrongEntityTag } from '../platform/http/entity-tag';
import { parseProjectVersionPrecondition } from '../projects/project-http';
import { ArchitectureService } from './architecture.service';

@ApiTags('architecture')
@ApiBearerAuth('session-bearer')
@ApiCookieAuth('session-cookie')
@Controller('organizations/:organizationId/projects/:projectId/architecture')
export class ArchitectureController {
  constructor(@Inject(ArchitectureService) private readonly service: ArchitectureService) {}

  @Get('current')
  @Header('Cache-Control', 'no-store')
  @RequirePermission(PROJECT_READ)
  @ApiOperation({ operationId: 'getCurrentArchitectureBaseline', summary: 'Read the exact current architecture generation and decision' })
  current(@Req() request: AuthenticatedRequest, @Param('projectId') projectId: string) { return this.service.current(requireAccessContext(request), projectId); }

  @Post('generations')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @RequirePermission(ARCHITECTURE_GENERATE)
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ operationId: 'generateArchitectureOptions', summary: 'Compile and persist versioned current-graph architecture options' })
  async generate(@Req() request: AuthenticatedRequest, @Param('projectId') projectId: string, @Body() body: unknown, @Headers('if-match') ifMatch: unknown, @Headers('idempotency-key') idempotencyKey: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    const precondition = parseProjectVersionPrecondition(projectId, ifMatch);
    const result = await this.service.generate(requireAccessContext(request), precondition.projectId, body, precondition.expectedRowVersion, idempotencyKey, request.id);
    void reply.header('ETag', formatStrongEntityTag(result.project.id, result.project.rowVersion)); void reply.header('Idempotency-Replayed', String(result.replayed)); return result;
  }

  @Post('decisions')
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @RequirePermission(ARCHITECTURE_APPROVE)
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ operationId: 'approveArchitectureDecision', summary: 'Approve one exact option and compile the versioned ADR and HLD' })
  async approve(@Req() request: AuthenticatedRequest, @Param('projectId') projectId: string, @Body() body: unknown, @Headers('if-match') ifMatch: unknown, @Headers('idempotency-key') idempotencyKey: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    const precondition = parseProjectVersionPrecondition(projectId, ifMatch);
    const result = await this.service.approve(requireAccessContext(request), precondition.projectId, body, precondition.expectedRowVersion, idempotencyKey, request.id);
    void reply.header('ETag', formatStrongEntityTag(result.project.id, result.project.rowVersion)); void reply.header('Idempotency-Replayed', String(result.replayed)); return result;
  }
}
