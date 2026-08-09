import type { SubscriptionProviderEvent, SubscriptionWebhookReceipt } from './subscription-webhook.schema';

export type ProcessSubscriptionWebhookInput = {
  provider: string;
  event: SubscriptionProviderEvent;
  payloadHash: string;
  signatureTimestamp: string;
  requestId: string;
};

export type ProcessSubscriptionWebhookResult =
  | { ok: true; receipt: SubscriptionWebhookReceipt }
  | { ok: false; code: 'SUBSCRIPTION_NOT_FOUND' | 'PLAN_NOT_FOUND' | 'CURRENT_SUBSCRIPTION_CONFLICT' | 'PLAN_ALLOCATION_CONFLICT' | 'BILLING_POLICY_NOT_FOUND' };

export interface SubscriptionWebhookRepository {
  process(input: ProcessSubscriptionWebhookInput): Promise<ProcessSubscriptionWebhookResult>;
}

export class SubscriptionWebhookConflictError extends Error {
  constructor() { super('Webhook event ID was already used with different content'); }
}

export const SUBSCRIPTION_WEBHOOK_REPOSITORY = Symbol('SUBSCRIPTION_WEBHOOK_REPOSITORY');
