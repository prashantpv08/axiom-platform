import { Body, Controller, Get, Header, Headers, HttpCode, Inject, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiHeader, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';

import { requireAccessContext, requirePrincipal, type AuthenticatedRequest } from '../access/access-context';
import { Authenticated } from '../access/authenticated.decorator';
import { INVITATION_MANAGE, MEMBER_READ } from '../access/permissions';
import { RequirePermission } from '../access/require-permission.decorator';
import { ApplicationError } from '../../platform/application/application-error';
import { formatStrongEntityTag, parseRequiredVersionIfMatch } from '../../platform/http/entity-tag';
import { InvitationIdSchema, type InvitationResponse } from './governance.schema';
import { GovernanceService } from './governance.service';

@ApiTags('organization-governance')
@ApiBearerAuth('session-bearer')
@ApiCookieAuth('session-cookie')
@Controller('organizations/:organizationId')
export class GovernanceController {
  constructor(@Inject(GovernanceService) private readonly service: GovernanceService) {}

  @Get('members')
  @Header('Cache-Control', 'no-store')
  @RequirePermission(MEMBER_READ)
  @ApiOperation({ operationId: 'listOrganizationMembers', summary: 'List organization members' })
  listMembers(@Req() request: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    return this.service.listMembers(requireAccessContext(request), query);
  }

  @Get('invitations')
  @Header('Cache-Control', 'no-store')
  @RequirePermission(INVITATION_MANAGE)
  @ApiOperation({ operationId: 'listOrganizationInvitations', summary: 'List organization invitations' })
  listInvitations(@Req() request: AuthenticatedRequest, @Query() query: Record<string, unknown>) {
    return this.service.listInvitations(requireAccessContext(request), query);
  }

  @Post('invitations')
  @Header('Cache-Control', 'no-store')
  @RequirePermission(INVITATION_MANAGE)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOperation({ operationId: 'createOrganizationInvitation', summary: 'Create an organization invitation' })
  createInvitation(
    @Req() request: AuthenticatedRequest,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: unknown
  ) {
    return this.service.createInvitation(requireAccessContext(request), body, idempotencyKey, request.id);
  }

  @Post('invitations/:invitationId/revoke')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @RequirePermission(INVITATION_MANAGE)
  @ApiParam({ name: 'invitationId' })
  @ApiHeader({ name: 'If-Match', required: true })
  @ApiOperation({ operationId: 'revokeOrganizationInvitation', summary: 'Revoke a pending invitation' })
  async revokeInvitation(
    @Req() request: AuthenticatedRequest,
    @Param('invitationId') invitationId: string,
    @Headers('if-match') ifMatch: unknown,
    @Res({ passthrough: true }) reply: FastifyReply
  ): Promise<InvitationResponse> {
    const parsedInvitationId = InvitationIdSchema.safeParse(invitationId);
    if (!parsedInvitationId.success) throw new ApplicationError('NOT_FOUND', 'Invitation was not found');
    const expectedRowVersion = parseRequiredVersionIfMatch(
      ifMatch,
      parsedInvitationId.data,
      'If-Match header is invalid for this invitation'
    );
    const invitation = await this.service.revokeInvitation(
      requireAccessContext(request),
      parsedInvitationId.data,
      expectedRowVersion,
      request.id
    );
    void reply.header('ETag', formatStrongEntityTag(invitation.id, invitation.rowVersion));
    return invitation;
  }
}

@ApiTags('identity')
@ApiBearerAuth('session-bearer')
@ApiCookieAuth('session-cookie')
@Controller('invitations')
export class InvitationAcceptanceController {
  constructor(@Inject(GovernanceService) private readonly service: GovernanceService) {}

  @Post('accept')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Authenticated()
  @ApiOperation({ operationId: 'acceptOrganizationInvitation', summary: 'Accept an invitation for the authenticated email' })
  accept(@Req() request: AuthenticatedRequest, @Body() body: unknown) {
    return this.service.acceptInvitation(requirePrincipal(request), body, request.id);
  }
}
