import { Module } from '@nestjs/common';

import { BillingController } from './billing.controller';
import { BILLING_REPOSITORY } from './billing.repository';
import { BillingService } from './billing.service';
import { PostgresBillingRepository } from './postgres-billing.repository';
import { LocalFixtureSubscriptionAdapter } from './local-fixture-subscription.adapter';
import { SUBSCRIPTION_PROVIDER_ADAPTER } from './subscription-provider.adapter';
import { PostgresSubscriptionWebhookRepository } from './postgres-subscription-webhook.repository';
import { SUBSCRIPTION_WEBHOOK_REPOSITORY } from './subscription-webhook.repository';
import { SubscriptionWebhookController } from './subscription-webhook.controller';
import { SubscriptionWebhookService } from './subscription-webhook.service';

@Module({
  controllers: [BillingController, SubscriptionWebhookController],
  providers: [
    BillingService,
    PostgresBillingRepository,
    { provide: BILLING_REPOSITORY, useExisting: PostgresBillingRepository },
    SubscriptionWebhookService,
    LocalFixtureSubscriptionAdapter,
    { provide: SUBSCRIPTION_PROVIDER_ADAPTER, useExisting: LocalFixtureSubscriptionAdapter },
    PostgresSubscriptionWebhookRepository,
    { provide: SUBSCRIPTION_WEBHOOK_REPOSITORY, useExisting: PostgresSubscriptionWebhookRepository }
  ],
  exports: [BillingService]
})
export class BillingModule {}
