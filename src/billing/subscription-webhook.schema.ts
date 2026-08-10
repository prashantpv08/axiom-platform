import { z } from 'zod';

import { OrganizationIdSchema } from '../identity/identity.schema';

export const SubscriptionProviderCodeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/u);
export const SubscriptionWebhookEventIdSchema = z.string().regex(/^SWE-[A-Za-z0-9_-]{1,124}$/u);
export const ExternalProviderIdSchema = z.string().trim().min(1).max(200);
export const SubscriptionStatusSchema = z.enum(['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED']);
export const SUBSCRIPTION_WEBHOOK_SIGNATURE_PATTERN = /^t=([0-9]{10}),v1=([a-f0-9]{64})$/u;
export const SubscriptionWebhookSignatureSchema = z.string().regex(SUBSCRIPTION_WEBHOOK_SIGNATURE_PATTERN);

export const SubscriptionProviderEventSchema = z.object({
  externalEventId: ExternalProviderIdSchema,
  eventType: z.literal('SUBSCRIPTION_SNAPSHOT'),
  occurredAt: z.iso.datetime(),
  organizationId: OrganizationIdSchema,
  externalCustomerId: ExternalProviderIdSchema,
  externalSubscriptionId: ExternalProviderIdSchema,
  planCode: z.string().regex(/^[A-Z][A-Z0-9_]{1,63}$/u),
  status: SubscriptionStatusSchema,
  billingPeriodStart: z.iso.datetime(),
  billingPeriodEnd: z.iso.datetime()
}).strict().superRefine((value, context) => {
  const start = new Date(value.billingPeriodStart).getTime();
  const end = new Date(value.billingPeriodEnd).getTime();
  if (end <= start) {
    context.addIssue({ code: 'custom', message: 'Billing period end must follow its start', path: ['billingPeriodEnd'] });
  }
  if (end - start > 400 * 24 * 60 * 60 * 1_000) {
    context.addIssue({ code: 'custom', message: 'Billing period cannot exceed 400 days', path: ['billingPeriodEnd'] });
  }
});

export const SubscriptionWebhookReceiptSchema = z.object({
  webhookEventId: SubscriptionWebhookEventIdSchema,
  externalEventId: ExternalProviderIdSchema,
  outcome: z.enum(['PROCESSED', 'IGNORED']),
  subscriptionId: z.string().regex(/^SUB-[A-Za-z0-9_-]{1,124}$/u),
  subscriptionRowVersion: z.number().int().positive(),
  replayed: z.boolean()
}).strict();

export type SubscriptionProviderEvent = z.infer<typeof SubscriptionProviderEventSchema>;
export type SubscriptionWebhookReceipt = z.infer<typeof SubscriptionWebhookReceiptSchema>;
