import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common';

import {
  SUBSCRIPTION_PROVIDER_ADAPTER,
  SubscriptionWebhookAuthenticationError,
  SubscriptionWebhookPayloadError,
  SubscriptionWebhookUnavailableError,
  type SubscriptionProviderAdapter
} from './subscription-provider.adapter';
import {
  SUBSCRIPTION_WEBHOOK_REPOSITORY,
  SubscriptionWebhookConflictError,
  type SubscriptionWebhookRepository
} from './subscription-webhook.repository';

@Injectable()
export class SubscriptionWebhookService {
  constructor(
    @Inject(SUBSCRIPTION_PROVIDER_ADAPTER) private readonly provider: SubscriptionProviderAdapter,
    @Inject(SUBSCRIPTION_WEBHOOK_REPOSITORY) private readonly repository: SubscriptionWebhookRepository
  ) {}

  async receiveLocalFixture(rawBody: Buffer, signatureHeader: unknown, requestId: string) {
    try {
      const authenticated = this.provider.authenticateWebhook({
        rawBody,
        signatureHeader: typeof signatureHeader === 'string' ? signatureHeader : undefined,
        receivedAt: new Date()
      });
      const result = await this.repository.process({
        provider: this.provider.providerCode,
        ...authenticated,
        requestId
      });
      if (!result.ok) {
        throw new UnprocessableEntityException(`Subscription webhook could not be applied: ${result.code}`);
      }
      return result.receipt;
    } catch (cause) {
      if (cause instanceof SubscriptionWebhookUnavailableError) throw new NotFoundException(cause.message);
      if (cause instanceof SubscriptionWebhookAuthenticationError) throw new UnauthorizedException(cause.message);
      if (cause instanceof SubscriptionWebhookPayloadError) throw new BadRequestException(cause.message);
      if (cause instanceof SubscriptionWebhookConflictError) throw new ConflictException(cause.message);
      throw cause;
    }
  }
}
