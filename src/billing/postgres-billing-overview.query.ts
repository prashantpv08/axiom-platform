import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, gte, inArray, lte, sql } from 'drizzle-orm';

import type { AxiomDatabase } from '../database/client';
import { DATABASE } from '../database/database.module';
import {
  budgetPolicies,
  creditBalances,
  planEntitlements,
  plans,
  subscriptions,
  usageLedgerEntries,
  usageReservations
} from '../database/schema';
import type { BillingScope } from './billing.repository';
import { BillingOverviewSchema } from './billing.schema';
import { dayStartUtc, entitlementLimit, iso } from './postgres-billing.persistence';

@Injectable()
export class PostgresBillingOverviewQuery {
  constructor(@Inject(DATABASE) private readonly database: AxiomDatabase) {}

  async getOverview(scope: BillingScope) {
    const now = new Date().toISOString();
    const [record] = await this.database
      .select({
        planId: plans.id,
        planCode: plans.code,
        planName: plans.name,
        currency: plans.currency,
        subscriptionId: subscriptions.id,
        subscriptionStatus: subscriptions.status,
        billingPeriodStart: subscriptions.billingPeriodStart,
        billingPeriodEnd: subscriptions.billingPeriodEnd,
        balanceId: creditBalances.id,
        allocatedCreditUnits: creditBalances.allocatedCreditUnits,
        reservedCreditUnits: creditBalances.reservedCreditUnits,
        consumedCreditUnits: creditBalances.consumedCreditUnits,
        rowVersion: creditBalances.rowVersion,
        policyId: budgetPolicies.id,
        dailyCreditLimit: budgetPolicies.dailyCreditLimit,
        userDailyCreditLimit: budgetPolicies.userDailyCreditLimit,
        projectDailyCreditLimit: budgetPolicies.projectDailyCreditLimit,
        alertThresholdPercent: budgetPolicies.alertThresholdPercent,
        policyRowVersion: budgetPolicies.rowVersion,
        policyUpdatedAt: budgetPolicies.updatedAt
      })
      .from(subscriptions)
      .innerJoin(plans, eq(plans.id, subscriptions.planId))
      .innerJoin(
        creditBalances,
        and(
          eq(creditBalances.organizationId, subscriptions.organizationId),
          eq(creditBalances.subscriptionId, subscriptions.id),
          eq(creditBalances.periodStart, subscriptions.billingPeriodStart),
          eq(creditBalances.periodEnd, subscriptions.billingPeriodEnd)
        )
      )
      .innerJoin(budgetPolicies, eq(budgetPolicies.organizationId, subscriptions.organizationId))
      .where(and(
        eq(subscriptions.organizationId, scope.organizationId),
        inArray(subscriptions.status, ['TRIALING', 'ACTIVE', 'PAST_DUE']),
        lte(subscriptions.billingPeriodStart, now),
        gt(subscriptions.billingPeriodEnd, now)
      ))
      .limit(1);

    if (record === undefined) return null;

    const today = dayStartUtc(new Date(now));
    const [entitlementRows, ledgerRows, [dailyUsage], [expired]] = await Promise.all([
      this.database
        .select({ key: planEntitlements.key, enabled: planEntitlements.enabled, integerLimit: planEntitlements.integerLimit })
        .from(planEntitlements)
        .where(eq(planEntitlements.planId, record.planId)),
      this.database
        .select()
        .from(usageLedgerEntries)
        .where(eq(usageLedgerEntries.organizationId, scope.organizationId))
        .orderBy(desc(usageLedgerEntries.occurredAt), desc(usageLedgerEntries.id))
        .limit(25),
      this.database
        .select({
          committedCreditUnits: sql<number>`coalesce(sum(case when ${usageReservations.status} = 'RESERVED' then ${usageReservations.estimatedCreditUnits} when ${usageReservations.status} = 'RECONCILED' then ${usageReservations.actualCreditUnits} else 0 end), 0)::int`
        })
        .from(usageReservations)
        .where(and(
          eq(usageReservations.organizationId, scope.organizationId),
          eq(usageReservations.creditBalanceId, record.balanceId),
          inArray(usageReservations.status, ['RESERVED', 'RECONCILED']),
          gte(usageReservations.createdAt, today)
        )),
      this.database
        .select({
          count: sql<number>`count(*)::int`,
          reservedCreditUnits: sql<number>`coalesce(sum(${usageReservations.estimatedCreditUnits}), 0)::int`
        })
        .from(usageReservations)
        .where(and(
          eq(usageReservations.organizationId, scope.organizationId),
          eq(usageReservations.creditBalanceId, record.balanceId),
          eq(usageReservations.status, 'RESERVED'),
          lte(usageReservations.expiresAt, now)
        ))
    ]);

    const aiUsage = entitlementRows.find((item) => item.key === 'AI_USAGE');
    const requestLimit = entitlementRows.find((item) => item.key === 'MAX_CREDITS_PER_REQUEST');
    const committed = record.reservedCreditUnits + record.consumedCreditUnits;
    const remaining = record.allocatedCreditUnits - committed;
    const committedPercent = record.allocatedCreditUnits === 0
      ? 100
      : Math.min(100, Math.round((committed / record.allocatedCreditUnits) * 10_000) / 100);
    const status = remaining === 0
      ? 'EXHAUSTED'
      : committedPercent >= record.alertThresholdPercent ? 'APPROACHING' : 'AVAILABLE';
    const committedToday = dailyUsage?.committedCreditUnits ?? 0;

    return BillingOverviewSchema.parse({
      plan: { id: record.planId, code: record.planCode, name: record.planName, currency: record.currency },
      subscription: {
        id: record.subscriptionId,
        status: record.subscriptionStatus,
        billingPeriodStart: iso(record.billingPeriodStart),
        billingPeriodEnd: iso(record.billingPeriodEnd)
      },
      entitlements: {
        aiUsageEnabled: aiUsage?.enabled === true,
        maxCreditsPerRequest: requestLimit?.enabled === true ? requestLimit.integerLimit ?? 0 : 0,
        maxDailyCredits: entitlementLimit(entitlementRows, 'MAX_DAILY_CREDITS'),
        maxUserDailyCredits: entitlementLimit(entitlementRows, 'MAX_USER_DAILY_CREDITS'),
        maxProjectDailyCredits: entitlementLimit(entitlementRows, 'MAX_PROJECT_DAILY_CREDITS')
      },
      policy: {
        id: record.policyId,
        dailyCreditLimit: record.dailyCreditLimit,
        userDailyCreditLimit: record.userDailyCreditLimit,
        projectDailyCreditLimit: record.projectDailyCreditLimit,
        alertThresholdPercent: record.alertThresholdPercent,
        rowVersion: record.policyRowVersion,
        updatedAt: iso(record.policyUpdatedAt)
      },
      balance: {
        id: record.balanceId,
        allocatedCreditUnits: record.allocatedCreditUnits,
        reservedCreditUnits: record.reservedCreditUnits,
        consumedCreditUnits: record.consumedCreditUnits,
        remainingCreditUnits: remaining,
        committedPercent,
        alertThresholdPercent: record.alertThresholdPercent,
        status,
        rowVersion: record.rowVersion
      },
      dailyUsage: {
        committedCreditUnits: committedToday,
        remainingCreditUnits: Math.max(0, record.dailyCreditLimit - committedToday)
      },
      expiredReservations: {
        count: expired?.count ?? 0,
        reservedCreditUnits: expired?.reservedCreditUnits ?? 0
      },
      recentUsage: ledgerRows.map((entry) => ({
        id: entry.id,
        reservationId: entry.reservationId,
        eventType: entry.eventType,
        reservedCreditUnits: entry.reservedCreditUnits,
        chargedCreditUnits: entry.chargedCreditUnits,
        releasedCreditUnits: entry.releasedCreditUnits,
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
        toolChargeMicros: entry.toolChargeMicros,
        providerCostMicros: entry.providerCostMicros,
        currency: entry.currency,
        outcome: entry.outcome,
        retryCount: entry.retryCount,
        fallbackUsed: entry.fallbackUsed,
        cacheHit: entry.cacheHit,
        projectId: entry.projectId,
        userId: entry.userId,
        workflow: entry.workflow,
        workflowVersion: entry.workflowVersion,
        provider: entry.provider,
        model: entry.model,
        generationId: entry.generationId,
        runId: entry.runId,
        occurredAt: iso(entry.occurredAt)
      }))
    });
  }
}
