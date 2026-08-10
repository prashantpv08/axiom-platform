import { Body, Controller, Header, Headers, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';

import { requireAccessContext, type AuthenticatedRequest } from '../identity/access/access-context';
import { WORK_ITEM_REVIEW } from '../identity/access/permissions';
import { RequirePermission } from '../identity/access/require-permission.decorator';
import { ApplicationError } from '../platform/application/application-error';
import { formatStrongEntityTag, parseStrongEntityTag } from '../platform/http/entity-tag';
import { ProjectIdSchema } from '../projects/project.schema';
import { WorkItemGenerationIdSchema, type WorkItemGenerationPreview } from './work-item-generation.schema';
import { WorkItemGenerationReviewEtagSchema } from './work-item-review.schema';
import { WorkItemReviewService } from './work-item-review.service';

@ApiTags('work-items')
@ApiBearerAuth('session-bearer')
@ApiCookieAuth('session-cookie')
@Controller('organizations/:organizationId/projects/:projectId/work-item-generations/:generationId/reviews')
export class WorkItemReviewController {
  constructor(@Inject(WorkItemReviewService) private readonly service: WorkItemReviewService) {}

  @Post()
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @RequirePermission(WORK_ITEM_REVIEW)
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ operationId: 'submitWorkItemReview', summary: 'Accept, accept with edits, or reject an exact work-item generation' })
  async submit(
    @Req() request: AuthenticatedRequest,
    @Param('projectId') projectId: string,
    @Param('generationId') generationId: string,
    @Body() body: unknown,
    @Headers('if-match') ifMatch: unknown,
    @Headers('idempotency-key') idempotencyKey: unknown,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<WorkItemGenerationPreview> {
    const parsedProjectId = ProjectIdSchema.safeParse(projectId);
    const parsedGenerationId = WorkItemGenerationIdSchema.safeParse(generationId);
    if (!parsedProjectId.success || !parsedGenerationId.success) {
      throw new ApplicationError('NOT_FOUND', 'Work-item generation was not found');
    }
    const validatedIfMatch = parseStrongEntityTag(
      ifMatch,
      (candidate) => WorkItemGenerationReviewEtagSchema.safeParse(candidate).success,
      'Work-item review request is invalid'
    );
    const preview = await this.service.submit(
      requireAccessContext(request),
      parsedProjectId.data,
      parsedGenerationId.data,
      body,
      validatedIfMatch,
      idempotencyKey,
      request.id
    );
    void reply.header('Idempotency-Replayed', String(preview.replayed));
    void reply.header('ETag', formatStrongEntityTag(preview.id, preview.contentHash));
    return preview;
  }
}
