import type { SubscriptionProviderEvent } from './subscription-webhook.schema';

export type AuthenticateSubscriptionWebhookInput = {
  rawBody: Buffer;
  signatureHeader: string | undefined;
  receivedAt: Date;
};

export type AuthenticatedSubscriptionWebhook = {
  event: SubscriptionProviderEvent;
  payloadHash: string;
  signatureTimestamp: string;
};

export interface SubscriptionProviderAdapter {
  readonly providerCode: string;
  authenticateWebhook(input: AuthenticateSubscriptionWebhookInput): AuthenticatedSubscriptionWebhook;
}

export class SubscriptionWebhookUnavailableError extends Error {
  constructor() { super('Subscription webhook endpoint is unavailable'); }
}

export class SubscriptionWebhookAuthenticationError extends Error {
  constructor() { super('Subscription webhook authentication failed'); }
}

export class SubscriptionWebhookPayloadError extends Error {
  constructor() { super('Subscription webhook payload is invalid'); }
}

export const SUBSCRIPTION_PROVIDER_ADAPTER = Symbol('SUBSCRIPTION_PROVIDER_ADAPTER');
