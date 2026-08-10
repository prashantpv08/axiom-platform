import { Body, Controller, Header, Headers, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';

import { requireAccessContext, type AuthenticatedRequest } from '../identity/access/access-context';
import { CLARIFICATION_ANSWER } from '../identity/access/permissions';
import { RequirePermission } from '../identity/access/require-permission.decorator';
import { formatStrongEntityTag } from '../platform/http/entity-tag';
import type { ClarificationAnswerResponse } from './clarification.schema';
import { ClarificationService } from './clarification.service';
import { parseProjectVersionPrecondition } from './project-http';

@ApiTags('clarifications')
@ApiBearerAuth('session-bearer')
@ApiCookieAuth('session-cookie')
@RequirePermission(CLARIFICATION_ANSWER)
@Controller('organizations/:organizationId/projects/:projectId/clarifications')
export class ClarificationController {
  constructor(@Inject(ClarificationService) private readonly clarificationService: ClarificationService) {}

  @Post(':questionId/answer')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'answerProjectClarification', summary: 'Create a human-confirmed graph version from an exact clarification answer' })
  @ApiParam({ name: 'organizationId', example: 'ORG-LOCAL-DEVELOPMENT' })
  @ApiParam({ name: 'projectId', example: 'PROJ-123' })
  @ApiParam({ name: 'questionId', example: 'CQ-123' })
  @ApiHeader({ name: 'If-Match', required: true, description: 'Strong current project ETag' })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Stable key for unknown-result retries' })
  @ApiOkResponse({ description: 'Clarification answer applied as a new graph version' })
  @ApiResponse({ status: 409, description: 'Question is answered, project state is invalid, or idempotency conflicts' })
  @ApiResponse({ status: 412, description: 'Project row version changed' })
  @ApiResponse({ status: 428, description: 'If-Match is required' })
  async answer(
    @Req() request: AuthenticatedRequest,
    @Param('projectId') projectId: string,
    @Param('questionId') questionId: string,
    @Body() body: unknown,
    @Headers('if-match') ifMatch: unknown,
    @Headers('idempotency-key') idempotencyKey: unknown,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<ClarificationAnswerResponse> {
    const precondition = parseProjectVersionPrecondition(projectId, ifMatch);
    const result = await this.clarificationService.answer(
      requireAccessContext(request),
      precondition.projectId,
      questionId,
      body,
      precondition.expectedRowVersion,
      idempotencyKey,
      request.id
    );
    void reply.header('ETag', formatStrongEntityTag(result.project.id, result.project.rowVersion));
    void reply.header('Idempotency-Replayed', String(result.replayed));
    return result;
  }
}
