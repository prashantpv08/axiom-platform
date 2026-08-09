import { Controller, Headers, HttpCode, Inject, Post, Req } from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ApiHeader, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { Public } from '../identity/access/public.decorator';
import { SubscriptionWebhookService } from './subscription-webhook.service';

@ApiTags('subscription-webhooks')
@Public()
@Controller('webhooks/subscriptions')
export class SubscriptionWebhookController {
  constructor(@Inject(SubscriptionWebhookService) private readonly service: SubscriptionWebhookService) {}

  @Post('local-fixture')
  @HttpCode(200)
  @ApiHeader({ name: 'X-Axiom-Subscription-Signature', required: true, description: 'Local fixture HMAC timestamp and signature' })
  @ApiOperation({ operationId: 'receiveLocalFixtureSubscriptionWebhook', summary: 'Authenticate and process a local subscription fixture event' })
  @ApiOkResponse({ description: 'Provider event was processed, ignored as stale, or replayed safely' })
  receive(
    @Req() request: RawBodyRequest<FastifyRequest>,
    @Headers('x-axiom-subscription-signature') signature: unknown
  ) {
    return this.service.receiveLocalFixture(request.rawBody ?? Buffer.alloc(0), signature, request.id);
  }
}
