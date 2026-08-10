import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import {
  SubscriptionWebhookAuthenticationError,
  SubscriptionWebhookPayloadError,
  SubscriptionWebhookUnavailableError,
  type AuthenticatedSubscriptionWebhook,
  type AuthenticateSubscriptionWebhookInput,
  type SubscriptionProviderAdapter
} from './subscription-provider.adapter';
import {
  SUBSCRIPTION_WEBHOOK_SIGNATURE_PATTERN,
  SubscriptionProviderEventSchema
} from './subscription-webhook.schema';

const MAX_BODY_BYTES = 64 * 1_024;
const SIGNATURE_TOLERANCE_SECONDS = 300;

@Injectable()
export class LocalFixtureSubscriptionAdapter implements SubscriptionProviderAdapter {
  readonly providerCode = 'LOCAL_FIXTURE';

  private secret(): string {
    if (process.env.AXIOM_LOCAL_SUBSCRIPTION_WEBHOOK_ENABLED !== 'true') {
      throw new SubscriptionWebhookUnavailableError();
    }
    const secret = process.env.AXIOM_LOCAL_SUBSCRIPTION_WEBHOOK_SECRET;
    if (secret === undefined || Buffer.byteLength(secret, 'utf8') < 32) {
      throw new SubscriptionWebhookUnavailableError();
    }
    return secret;
  }

  authenticateWebhook(input: AuthenticateSubscriptionWebhookInput): AuthenticatedSubscriptionWebhook {
    const secret = this.secret();
    if (input.rawBody.byteLength === 0 || input.rawBody.byteLength > MAX_BODY_BYTES) {
      throw new SubscriptionWebhookPayloadError();
    }
    const signature = input.signatureHeader === undefined
      ? null
      : SUBSCRIPTION_WEBHOOK_SIGNATURE_PATTERN.exec(input.signatureHeader);
    if (signature === null) throw new SubscriptionWebhookAuthenticationError();

    const timestampSeconds = Number(signature[1]!);
    const receivedSeconds = Math.floor(input.receivedAt.getTime() / 1_000);
    if (!Number.isSafeInteger(timestampSeconds) || Math.abs(receivedSeconds - timestampSeconds) > SIGNATURE_TOLERANCE_SECONDS) {
      throw new SubscriptionWebhookAuthenticationError();
    }
    const expected = createHmac('sha256', secret)
      .update(`${timestampSeconds}.`, 'utf8')
      .update(input.rawBody)
      .digest();
    const supplied = Buffer.from(signature[2]!, 'hex');
    if (supplied.byteLength !== expected.byteLength || !timingSafeEqual(expected, supplied)) {
      throw new SubscriptionWebhookAuthenticationError();
    }

    let raw: unknown;
    try {
      raw = JSON.parse(input.rawBody.toString('utf8')) as unknown;
    } catch {
      throw new SubscriptionWebhookPayloadError();
    }
    const event = SubscriptionProviderEventSchema.safeParse(raw);
    if (!event.success) throw new SubscriptionWebhookPayloadError();

    return {
      event: event.data,
      payloadHash: createHash('sha256').update(input.rawBody).digest('hex'),
      signatureTimestamp: new Date(timestampSeconds * 1_000).toISOString()
    };
  }
}
