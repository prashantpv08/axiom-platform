import { createHmac, randomUUID } from 'node:crypto';

import { SubscriptionWebhookReceiptSchema } from '../src/billing/subscription-webhook.schema';
import { OrganizationIdSchema } from '../src/identity/identity.schema';

const apply = process.argv.includes('--apply');
const organizationId = OrganizationIdSchema.parse(process.env.AXIOM_LOCAL_ORGANIZATION_ID ?? 'ORG-LOCAL-DEVELOPMENT');
const eventIdArgument = process.argv.find((argument) => argument.startsWith('--event-id='));
const occurredAtArgument = process.argv.find((argument) => argument.startsWith('--occurred-at='));
if (apply && (eventIdArgument === undefined || occurredAtArgument === undefined)) {
  throw new Error('Applied fixtures require the exact --event-id and --occurred-at values shown by preview mode');
}
const externalEventId = eventIdArgument?.slice('--event-id='.length) || `fixture-event-${randomUUID()}`;
const eventTime = occurredAtArgument === undefined ? new Date() : new Date(occurredAtArgument.slice('--occurred-at='.length));
if (Number.isNaN(eventTime.getTime())) throw new Error('--occurred-at must be an ISO-8601 timestamp');
const occurredAt = eventTime.toISOString();
const periodStart = new Date(Date.UTC(eventTime.getUTCFullYear(), eventTime.getUTCMonth(), 1)).toISOString();
const periodEnd = new Date(Date.UTC(eventTime.getUTCFullYear(), eventTime.getUTCMonth() + 1, 1)).toISOString();
const event = {
  externalEventId,
  eventType: 'SUBSCRIPTION_SNAPSHOT',
  occurredAt,
  organizationId,
  externalCustomerId: `fixture-customer-${organizationId}`,
  externalSubscriptionId: `fixture-subscription-${organizationId}`,
  planCode: 'LOCAL_DEVELOPMENT',
  status: 'TRIALING',
  billingPeriodStart: periodStart,
  billingPeriodEnd: periodEnd
} as const;

function localEndpoint(): URL {
  const endpoint = new URL('/api/v1/webhooks/subscriptions/local-fixture', process.env.AXIOM_PLATFORM_URL ?? 'http://127.0.0.1:4100');
  if (endpoint.protocol !== 'http:' || (endpoint.hostname !== '127.0.0.1' && endpoint.hostname !== 'localhost')) {
    throw new Error('Local subscription fixture is restricted to a localhost HTTP platform endpoint');
  }
  return endpoint;
}

async function main(): Promise<void> {
  process.stdout.write(`${JSON.stringify({ mode: apply ? 'APPLY' : 'PREVIEW', endpoint: localEndpoint().toString(), event }, null, 2)}\n`);
  if (!apply) {
    process.stdout.write(`Preview only. To send this exact fixture, re-run with --apply --event-id=${externalEventId} --occurred-at=${occurredAt}\n`);
    return;
  }
  if (process.env.AXIOM_LOCAL_SUBSCRIPTION_WEBHOOK_ENABLED !== 'true') {
    throw new Error('AXIOM_LOCAL_SUBSCRIPTION_WEBHOOK_ENABLED must be true for an applied fixture');
  }
  const secret = process.env.AXIOM_LOCAL_SUBSCRIPTION_WEBHOOK_SECRET;
  if (secret === undefined || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('AXIOM_LOCAL_SUBSCRIPTION_WEBHOOK_SECRET must contain at least 32 bytes');
  }
  const rawBody = JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1_000);
  const signature = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex');
  const response = await fetch(localEndpoint(), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-axiom-subscription-signature': `t=${timestamp},v1=${signature}`
    },
    body: rawBody,
    signal: AbortSignal.timeout(5_000)
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Local webhook failed with HTTP ${response.status}`);
  const receipt = SubscriptionWebhookReceiptSchema.parse(body);
  process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
}

void main();
