import { Body, Controller, Get, Header, Headers, HttpCode, Inject, Param, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiCookieAuth, ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';

import { requireAccessContext, type AuthenticatedRequest } from '../identity/access/access-context';
import { BILLING_MANAGE, BILLING_READ } from '../identity/access/permissions';
import { RequirePermission } from '../identity/access/require-permission.decorator';
import { BillingService, budgetPolicyEtag } from './billing.service';

@ApiTags('billing')
@ApiBearerAuth('session-bearer')
@ApiCookieAuth('session-cookie')
@RequirePermission(BILLING_READ)
@Controller('organizations/:organizationId/billing')
export class BillingController {
  constructor(@Inject(BillingService) private readonly billingService: BillingService) {}

  @Get('overview')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ operationId: 'getBillingOverview', summary: 'Read the authorized organization plan and usage balance' })
  @ApiOkResponse({ description: 'Current plan, entitlements, credit balance, and immutable usage events' })
  getOverview(@Req() request: AuthenticatedRequest) {
    return this.billingService.getOverview(requireAccessContext(request));
  }

  @Post('policy/:policyId')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @RequirePermission(BILLING_MANAGE)
  @ApiHeader({ name: 'If-Match', required: true, description: 'Current budget policy ETag' })
  @ApiHeader({ name: 'Idempotency-Key', required: true, description: 'Stable key for safe policy update retries' })
  @ApiOperation({ operationId: 'updateBudgetPolicy', summary: 'Update authorized organization budget controls' })
  async updatePolicy(
    @Req() request: AuthenticatedRequest,
    @Param('policyId') policyId: string,
    @Body() body: unknown,
    @Headers('if-match') ifMatch: unknown,
    @Headers('idempotency-key') idempotencyKey: unknown,
    @Res({ passthrough: true }) reply: FastifyReply
  ) {
    const policy = await this.billingService.updatePolicy(
      requireAccessContext(request),
      body,
      policyId,
      ifMatch,
      idempotencyKey,
      request.id
    );
    void reply.header('ETag', budgetPolicyEtag(policy));
    void reply.header('Idempotency-Replayed', String(policy.replayed));
    return policy;
  }

  @Post('reservations/recover-expired')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @RequirePermission(BILLING_MANAGE)
  @ApiOperation({ operationId: 'recoverExpiredUsageReservations', summary: 'Release expired organization reservations safely' })
  recoverExpiredReservations(@Req() request: AuthenticatedRequest) {
    return this.billingService.recoverExpiredReservations(requireAccessContext(request), request.id);
  }
}
