import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';

import type { AxiomDatabase } from '../database/client';
import { DATABASE } from '../database/database.module';
import {
  auditEvents,
  budgetPolicies,
  creditBalances,
  planEntitlements,
  plans,
  subscriptionWebhookEvents,
  subscriptions
} from '../database/schema';
import {
  SubscriptionWebhookConflictError,
  type ProcessSubscriptionWebhookInput,
  type ProcessSubscriptionWebhookResult,
  type SubscriptionWebhookRepository
} from './subscription-webhook.repository';
import { SubscriptionWebhookReceiptSchema, type SubscriptionWebhookReceipt } from './subscription-webhook.schema';

type FailureCode = Extract<ProcessSubscriptionWebhookResult, { ok: false }>['code'];

function entitlementLimit(rows: Array<{ key: string; enabled: boolean; integerLimit: number | null }>, key: string): number {
  const entitlement = rows.find((item) => item.key === key);
  return entitlement?.enabled === true ? entitlement.integerLimit ?? 0 : 0;
}

@Injectable()
export class PostgresSubscriptionWebhookRepository implements SubscriptionWebhookRepository {
  constructor(@Inject(DATABASE) private readonly database: AxiomDatabase) {}

  async process(input: ProcessSubscriptionWebhookInput): Promise<ProcessSubscriptionWebhookResult> {
    return this.database.transaction(async (transaction) => {
      await transaction.insert(subscriptionWebhookEvents).values({
        id: `SWE-${randomUUID()}`,
        organizationId: input.event.organizationId,
        provider: input.provider,
        externalEventId: input.event.externalEventId,
        eventType: input.event.eventType,
        payloadHash: input.payloadHash,
        normalizedPayload: input.event,
        signatureTimestamp: input.signatureTimestamp
      }).onConflictDoNothing();

      const [webhook] = await transaction.select().from(subscriptionWebhookEvents).where(and(
        eq(subscriptionWebhookEvents.provider, input.provider),
        eq(subscriptionWebhookEvents.externalEventId, input.event.externalEventId)
      )).limit(1).for('update');
      if (webhook === undefined) throw new Error('Subscription webhook inbox row is missing');
      if (webhook.payloadHash !== input.payloadHash || webhook.organizationId !== input.event.organizationId) {
        throw new SubscriptionWebhookConflictError();
      }
      if ((webhook.status === 'PROCESSED' || webhook.status === 'IGNORED') && webhook.responsePayload !== null) {
        return {
          ok: true,
          receipt: SubscriptionWebhookReceiptSchema.parse({ ...webhook.responsePayload, replayed: true })
        };
      }

      const processedAt = new Date().toISOString();
      const fail = async (code: FailureCode): Promise<ProcessSubscriptionWebhookResult> => {
        await transaction.update(subscriptionWebhookEvents).set({
          status: 'FAILED',
          attemptCount: sql`${subscriptionWebhookEvents.attemptCount} + 1`,
          lastErrorCode: code,
          responsePayload: null,
          processedAt,
          updatedAt: processedAt
        }).where(eq(subscriptionWebhookEvents.id, webhook.id));
        await transaction.insert(auditEvents).values({
          id: `AUDIT-${randomUUID()}`,
          organizationId: input.event.organizationId,
          actorUserId: null,
          action: 'SUBSCRIPTION_WEBHOOK_FAILED',
          targetType: 'SubscriptionWebhookEvent',
          targetId: webhook.id,
          requestId: input.requestId,
          metadata: {
            provider: input.provider,
            externalEventId: input.event.externalEventId,
            eventType: input.event.eventType,
            errorCode: code,
            attempt: webhook.attemptCount + 1
          }
        });
        return { ok: false, code };
      };

      const [subscription] = await transaction.select().from(subscriptions).where(and(
        eq(subscriptions.organizationId, input.event.organizationId),
        eq(subscriptions.provider, input.provider),
        eq(subscriptions.externalCustomerId, input.event.externalCustomerId),
        eq(subscriptions.externalSubscriptionId, input.event.externalSubscriptionId)
      )).limit(1).for('update');
      if (subscription === undefined) return fail('SUBSCRIPTION_NOT_FOUND');

      if (subscription.providerUpdatedAt !== null && new Date(input.event.occurredAt) <= new Date(subscription.providerUpdatedAt)) {
        const receipt = SubscriptionWebhookReceiptSchema.parse({
          webhookEventId: webhook.id,
          externalEventId: input.event.externalEventId,
          outcome: 'IGNORED',
          subscriptionId: subscription.id,
          subscriptionRowVersion: subscription.rowVersion,
          replayed: false
        });
        await transaction.update(subscriptionWebhookEvents).set({
          status: 'IGNORED',
          attemptCount: sql`${subscriptionWebhookEvents.attemptCount} + 1`,
          lastErrorCode: null,
          responsePayload: receipt,
          processedAt,
          updatedAt: processedAt
        }).where(eq(subscriptionWebhookEvents.id, webhook.id));
        await transaction.insert(auditEvents).values({
          id: `AUDIT-${randomUUID()}`,
          organizationId: input.event.organizationId,
          actorUserId: null,
          action: 'SUBSCRIPTION_WEBHOOK_IGNORED',
          targetType: 'Subscription',
          targetId: subscription.id,
          requestId: input.requestId,
          metadata: {
            provider: input.provider,
            externalEventId: input.event.externalEventId,
            providerUpdatedAt: subscription.providerUpdatedAt,
            eventOccurredAt: input.event.occurredAt,
            reason: 'OUT_OF_ORDER'
          }
        });
        return { ok: true, receipt };
      }

      const [plan] = await transaction.select().from(plans).where(and(
        eq(plans.code, input.event.planCode),
        eq(plans.status, 'ACTIVE')
      )).limit(1);
      if (plan === undefined) return fail('PLAN_NOT_FOUND');

      if (['TRIALING', 'ACTIVE', 'PAST_DUE'].includes(input.event.status)) {
        const [otherCurrent] = await transaction.select({ id: subscriptions.id }).from(subscriptions).where(and(
          eq(subscriptions.organizationId, input.event.organizationId),
          ne(subscriptions.id, subscription.id),
          inArray(subscriptions.status, ['TRIALING', 'ACTIVE', 'PAST_DUE'])
        )).limit(1);
        if (otherCurrent !== undefined) return fail('CURRENT_SUBSCRIPTION_CONFLICT');
      }

      const [balance] = await transaction.select().from(creditBalances).where(and(
        eq(creditBalances.organizationId, input.event.organizationId),
        eq(creditBalances.subscriptionId, subscription.id),
        eq(creditBalances.periodStart, input.event.billingPeriodStart),
        eq(creditBalances.periodEnd, input.event.billingPeriodEnd)
      )).limit(1).for('update');
      if (balance !== undefined && balance.reservedCreditUnits + balance.consumedCreditUnits > plan.billingPeriodCreditUnits) {
        return fail('PLAN_ALLOCATION_CONFLICT');
      }

      const policy = await transaction.select().from(budgetPolicies)
        .where(eq(budgetPolicies.organizationId, input.event.organizationId)).limit(1).for('update');
      const entitlementRows = await transaction
        .select({ key: planEntitlements.key, enabled: planEntitlements.enabled, integerLimit: planEntitlements.integerLimit })
        .from(planEntitlements).where(eq(planEntitlements.planId, plan.id));
      if (policy[0] === undefined) return fail('BILLING_POLICY_NOT_FOUND');

      const [updatedSubscription] = await transaction.update(subscriptions).set({
        planId: plan.id,
        status: input.event.status,
        billingPeriodStart: input.event.billingPeriodStart,
        billingPeriodEnd: input.event.billingPeriodEnd,
        providerUpdatedAt: input.event.occurredAt,
        providerEventId: input.event.externalEventId,
        rowVersion: sql`${subscriptions.rowVersion} + 1`,
        updatedAt: processedAt
      }).where(and(
        eq(subscriptions.organizationId, input.event.organizationId),
        eq(subscriptions.id, subscription.id),
        eq(subscriptions.rowVersion, subscription.rowVersion)
      )).returning();
      if (updatedSubscription === undefined) throw new Error('Locked subscription update failed');

      if (balance === undefined) {
        await transaction.insert(creditBalances).values({
          id: `BAL-${randomUUID()}`,
          organizationId: input.event.organizationId,
          subscriptionId: subscription.id,
          periodStart: input.event.billingPeriodStart,
          periodEnd: input.event.billingPeriodEnd,
          allocatedCreditUnits: plan.billingPeriodCreditUnits,
          alertThresholdPercent: policy[0].alertThresholdPercent
        });
      } else if (balance.allocatedCreditUnits !== plan.billingPeriodCreditUnits) {
        await transaction.update(creditBalances).set({
          allocatedCreditUnits: plan.billingPeriodCreditUnits,
          rowVersion: sql`${creditBalances.rowVersion} + 1`,
          updatedAt: processedAt
        }).where(and(eq(creditBalances.organizationId, input.event.organizationId), eq(creditBalances.id, balance.id)));
      }

      const maximumDaily = Math.min(plan.billingPeriodCreditUnits, entitlementLimit(entitlementRows, 'MAX_DAILY_CREDITS'));
      const maximumUserDaily = Math.min(maximumDaily, entitlementLimit(entitlementRows, 'MAX_USER_DAILY_CREDITS'));
      const maximumProjectDaily = Math.min(maximumDaily, entitlementLimit(entitlementRows, 'MAX_PROJECT_DAILY_CREDITS'));
      const policyUpdate = {
        dailyCreditLimit: Math.min(policy[0].dailyCreditLimit, maximumDaily),
        userDailyCreditLimit: Math.min(policy[0].userDailyCreditLimit, maximumUserDaily),
        projectDailyCreditLimit: Math.min(policy[0].projectDailyCreditLimit, maximumProjectDaily)
      };
      if (
        policyUpdate.dailyCreditLimit !== policy[0].dailyCreditLimit
        || policyUpdate.userDailyCreditLimit !== policy[0].userDailyCreditLimit
        || policyUpdate.projectDailyCreditLimit !== policy[0].projectDailyCreditLimit
      ) {
        await transaction.update(budgetPolicies).set({
          ...policyUpdate,
          rowVersion: sql`${budgetPolicies.rowVersion} + 1`,
          updatedAt: processedAt
        }).where(eq(budgetPolicies.id, policy[0].id));
      }

      const receipt: SubscriptionWebhookReceipt = SubscriptionWebhookReceiptSchema.parse({
        webhookEventId: webhook.id,
        externalEventId: input.event.externalEventId,
        outcome: 'PROCESSED',
        subscriptionId: updatedSubscription.id,
        subscriptionRowVersion: updatedSubscription.rowVersion,
        replayed: false
      });
      await transaction.update(subscriptionWebhookEvents).set({
        status: 'PROCESSED',
        attemptCount: sql`${subscriptionWebhookEvents.attemptCount} + 1`,
        lastErrorCode: null,
        responsePayload: receipt,
        processedAt,
        updatedAt: processedAt
      }).where(eq(subscriptionWebhookEvents.id, webhook.id));
      await transaction.insert(auditEvents).values({
        id: `AUDIT-${randomUUID()}`,
        organizationId: input.event.organizationId,
        actorUserId: null,
        action: 'SUBSCRIPTION_WEBHOOK_PROCESSED',
        targetType: 'Subscription',
        targetId: subscription.id,
        requestId: input.requestId,
        metadata: {
          provider: input.provider,
          externalEventId: input.event.externalEventId,
          webhookEventId: webhook.id,
          previous: {
            planId: subscription.planId,
            status: subscription.status,
            billingPeriodStart: subscription.billingPeriodStart,
            billingPeriodEnd: subscription.billingPeriodEnd,
            rowVersion: subscription.rowVersion
          },
          current: {
            planId: updatedSubscription.planId,
            status: updatedSubscription.status,
            billingPeriodStart: updatedSubscription.billingPeriodStart,
            billingPeriodEnd: updatedSubscription.billingPeriodEnd,
            rowVersion: updatedSubscription.rowVersion
          }
        }
      });

      return { ok: true, receipt };
    });
  }
}
