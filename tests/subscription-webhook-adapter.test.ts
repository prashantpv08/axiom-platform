import { createHmac } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalFixtureSubscriptionAdapter } from '../src/billing/local-fixture-subscription.adapter';
import {
  SubscriptionWebhookAuthenticationError,
  SubscriptionWebhookPayloadError,
  SubscriptionWebhookUnavailableError
} from '../src/billing/subscription-provider.adapter';

const secret = 'local-subscription-webhook-secret-at-least-32-bytes';
const event = {
  externalEventId: 'fixture-event-001',
  eventType: 'SUBSCRIPTION_SNAPSHOT',
  occurredAt: '2026-07-24T00:00:00.000Z',
  organizationId: 'ORG-ALPHA',
  externalCustomerId: 'fixture-customer-alpha',
  externalSubscriptionId: 'fixture-subscription-alpha',
  planCode: 'LOCAL_DEVELOPMENT',
  status: 'ACTIVE',
  billingPeriodStart: '2026-07-01T00:00:00.000Z',
  billingPeriodEnd: '2026-08-01T00:00:00.000Z'
} as const;

function signature(rawBody: Buffer, timestamp: number): string {
  const digest = createHmac('sha256', secret).update(`${timestamp}.`, 'utf8').update(rawBody).digest('hex');
  return `t=${timestamp},v1=${digest}`;
}

describe('local fixture subscription adapter', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is unavailable unless explicitly enabled with a strong local secret', () => {
    const adapter = new LocalFixtureSubscriptionAdapter();
    expect(() => adapter.authenticateWebhook({ rawBody: Buffer.from('{}'), signatureHeader: undefined, receivedAt: new Date() }))
      .toThrow(SubscriptionWebhookUnavailableError);
    vi.stubEnv('AXIOM_LOCAL_SUBSCRIPTION_WEBHOOK_ENABLED', 'true');
    vi.stubEnv('AXIOM_LOCAL_SUBSCRIPTION_WEBHOOK_SECRET', 'short');
    expect(() => adapter.authenticateWebhook({ rawBody: Buffer.from('{}'), signatureHeader: undefined, receivedAt: new Date() }))
      .toThrow(SubscriptionWebhookUnavailableError);
  });

  it('authenticates the exact raw body and returns a validated normalized event', () => {
    vi.stubEnv('AXIOM_LOCAL_SUBSCRIPTION_WEBHOOK_ENABLED', 'true');
    vi.stubEnv('AXIOM_LOCAL_SUBSCRIPTION_WEBHOOK_SECRET', secret);
    const adapter = new LocalFixtureSubscriptionAdapter();
    const receivedAt = new Date('2026-07-24T00:00:30.000Z');
    const timestamp = Math.floor(receivedAt.getTime() / 1_000);
    const rawBody = Buffer.from(JSON.stringify(event));
    expect(adapter.authenticateWebhook({ rawBody, signatureHeader: signature(rawBody, timestamp), receivedAt }))
      .toMatchObject({ event, signatureTimestamp: '2026-07-24T00:00:30.000Z' });
  });

  it('rejects stale, changed, malformed, and oversized payloads', () => {
    vi.stubEnv('AXIOM_LOCAL_SUBSCRIPTION_WEBHOOK_ENABLED', 'true');
    vi.stubEnv('AXIOM_LOCAL_SUBSCRIPTION_WEBHOOK_SECRET', secret);
    const adapter = new LocalFixtureSubscriptionAdapter();
    const receivedAt = new Date('2026-07-24T00:10:00.000Z');
    const rawBody = Buffer.from(JSON.stringify(event));
    const oldTimestamp = Math.floor(new Date('2026-07-24T00:00:00.000Z').getTime() / 1_000);
    expect(() => adapter.authenticateWebhook({ rawBody, signatureHeader: signature(rawBody, oldTimestamp), receivedAt }))
      .toThrow(SubscriptionWebhookAuthenticationError);
    const currentTimestamp = Math.floor(receivedAt.getTime() / 1_000);
    expect(() => adapter.authenticateWebhook({ rawBody: Buffer.from(`${rawBody.toString()} `), signatureHeader: signature(rawBody, currentTimestamp), receivedAt }))
      .toThrow(SubscriptionWebhookAuthenticationError);
    const malformed = Buffer.from('{');
    expect(() => adapter.authenticateWebhook({ rawBody: malformed, signatureHeader: signature(malformed, currentTimestamp), receivedAt }))
      .toThrow(SubscriptionWebhookPayloadError);
    const oversized = Buffer.alloc(64 * 1_024 + 1, 1);
    expect(() => adapter.authenticateWebhook({ rawBody: oversized, signatureHeader: signature(oversized, currentTimestamp), receivedAt }))
      .toThrow(SubscriptionWebhookPayloadError);
  });
});
