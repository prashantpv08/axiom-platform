import { createHash, randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, gte, inArray, lte, sql } from 'drizzle-orm';

import type { AxiomDatabase } from '../database/client';
import { DATABASE } from '../database/database.module';
import {
  auditEvents,
  budgetPolicies,
  creditBalances,
  idempotencyRecords,
  memberships,
  planEntitlements,
  plans,
  projects,
  subscriptions,
  usageLedgerEntries,
  usageReservations
} from '../database/schema';
import { BillingOverviewSchema, BudgetPolicySchema, ExpiredReservationRecoverySchema, UsageReservationSchema } from './billing.schema';
import {
  BillingEntitlementError,
  BillingNotProvisionedError,
  BudgetPolicyIdempotencyConflictError,
  BudgetPolicyLimitError,
  BudgetPolicyUpdateInProgressError,
  BudgetPolicyVersionConflictError,
  BudgetExhaustedError,
  DailyCreditLimitError,
  ProjectDailyCreditLimitError,
  RequestCreditLimitError,
  UsageAttributionError,
  UsageIdempotencyConflictError,
  UsageReconciliationConflictError,
  UsageReservationExceededError,
  UsageReservationNotFoundError,
  UserDailyCreditLimitError,
  type BillingRepository,
  type BillingScope,
  type ReconcileUsageInput,
  type RecoverExpiredReservationsInput,
  type ReserveUsageInput,
  type UpdateBudgetPolicyInput
} from './billing.repository';

type ReservationRow = typeof usageReservations.$inferSelect;

function iso(value: string | Date): string {
  return new Date(value).toISOString();
}

function reservationFromRow(row: ReservationRow, replayed: boolean) {
  return UsageReservationSchema.parse({
    id: row.id,
    projectId: row.projectId,
    userId: row.userId,
    workflow: row.workflow,
    workflowVersion: row.workflowVersion,
    provider: row.provider,
    model: row.model,
    generationId: row.generationId,
    runId: row.runId,
    estimatedCreditUnits: row.estimatedCreditUnits,
    actualCreditUnits: row.actualCreditUnits,
    status: row.status,
    outcome: row.outcome,
    expiresAt: iso(row.expiresAt),
    reconciledAt: row.reconciledAt === null ? null : iso(row.reconciledAt),
    createdAt: iso(row.createdAt),
    replayed
  });
}

type BudgetPolicyRow = typeof budgetPolicies.$inferSelect;

function policyFromRow(row: BudgetPolicyRow, replayed: boolean) {
  return BudgetPolicySchema.parse({
    id: row.id,
    dailyCreditLimit: row.dailyCreditLimit,
    userDailyCreditLimit: row.userDailyCreditLimit,
    projectDailyCreditLimit: row.projectDailyCreditLimit,
    alertThresholdPercent: row.alertThresholdPercent,
    rowVersion: row.rowVersion,
    updatedAt: iso(row.updatedAt),
    replayed
  });
}

function entitlementLimit(
  rows: Array<{ key: string; enabled: boolean; integerLimit: number | null }>,
  key: string
): number {
  const entitlement = rows.find((item) => item.key === key);
  return entitlement?.enabled === true ? entitlement.integerLimit ?? 0 : 0;
}

function dayStartUtc(now: Date): string {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  return start.toISOString();
}

@Injectable()
export class PostgresBillingRepository implements BillingRepository {
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

  async reserveUsage(scope: BillingScope, input: ReserveUsageInput) {
    await this.recoverExpiredReservations(scope, {
      requestId: `${input.requestId}.expiration`,
      actorUserId: input.userId,
      sessionId: input.sessionId
    });

    return this.database.transaction(async (transaction) => {
      const now = new Date().toISOString();
      const [subscription] = await transaction
        .select({ id: subscriptions.id, planId: subscriptions.planId, currency: plans.currency })
        .from(subscriptions)
        .innerJoin(plans, and(eq(plans.id, subscriptions.planId), eq(plans.status, 'ACTIVE')))
        .where(and(
          eq(subscriptions.organizationId, scope.organizationId),
          inArray(subscriptions.status, ['TRIALING', 'ACTIVE']),
          lte(subscriptions.billingPeriodStart, now),
          gt(subscriptions.billingPeriodEnd, now)
        ))
        .limit(1)
        .for('update');
      if (subscription === undefined) throw new BillingNotProvisionedError();

      const [balance] = await transaction
        .select()
        .from(creditBalances)
        .where(and(
          eq(creditBalances.organizationId, scope.organizationId),
          eq(creditBalances.subscriptionId, subscription.id),
          lte(creditBalances.periodStart, now),
          gt(creditBalances.periodEnd, now)
        ))
        .limit(1)
        .for('update');
      if (balance === undefined) throw new BillingNotProvisionedError();

      const [policy] = await transaction
        .select()
        .from(budgetPolicies)
        .where(eq(budgetPolicies.organizationId, scope.organizationId))
        .limit(1);
      if (policy === undefined) throw new BillingNotProvisionedError();

      const [existing] = await transaction
        .select()
        .from(usageReservations)
        .where(and(
          eq(usageReservations.organizationId, scope.organizationId),
          eq(usageReservations.idempotencyKey, input.idempotencyKey)
        ))
        .limit(1);
      if (existing !== undefined) {
        if (existing.requestHash !== input.requestHash) throw new UsageIdempotencyConflictError();
        return reservationFromRow(existing, true);
      }

      const [membership] = await transaction
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(and(
          eq(memberships.organizationId, scope.organizationId),
          eq(memberships.userId, input.userId),
          eq(memberships.status, 'ACTIVE')
        ))
        .limit(1);
      if (membership === undefined) throw new UsageAttributionError();

      if (input.projectId !== null) {
        const [project] = await transaction
          .select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.organizationId, scope.organizationId), eq(projects.id, input.projectId)))
          .limit(1);
        if (project === undefined) throw new UsageAttributionError();
      }

      const entitlementRows = await transaction
        .select({ key: planEntitlements.key, enabled: planEntitlements.enabled, integerLimit: planEntitlements.integerLimit })
        .from(planEntitlements)
        .where(eq(planEntitlements.planId, subscription.planId));
      const aiUsage = entitlementRows.find((item) => item.key === 'AI_USAGE');
      const requestLimit = entitlementRows.find((item) => item.key === 'MAX_CREDITS_PER_REQUEST');
      if (aiUsage?.enabled !== true) throw new BillingEntitlementError();
      if (requestLimit?.enabled !== true || requestLimit.integerLimit === null || input.estimatedCreditUnits > requestLimit.integerLimit) {
        throw new RequestCreditLimitError();
      }

      const today = dayStartUtc(new Date(now));
      const dailyBase = [
        eq(usageReservations.organizationId, scope.organizationId),
        eq(usageReservations.creditBalanceId, balance.id),
        inArray(usageReservations.status, ['RESERVED', 'RECONCILED']),
        gte(usageReservations.createdAt, today)
      ];
      const [[organizationDaily], [userDaily], projectDailyRows] = await Promise.all([
        transaction.select({
          committed: sql<number>`coalesce(sum(case when ${usageReservations.status} = 'RESERVED' then ${usageReservations.estimatedCreditUnits} when ${usageReservations.status} = 'RECONCILED' then ${usageReservations.actualCreditUnits} else 0 end), 0)::int`
        }).from(usageReservations).where(and(...dailyBase)),
        transaction.select({
          committed: sql<number>`coalesce(sum(case when ${usageReservations.status} = 'RESERVED' then ${usageReservations.estimatedCreditUnits} when ${usageReservations.status} = 'RECONCILED' then ${usageReservations.actualCreditUnits} else 0 end), 0)::int`
        }).from(usageReservations).where(and(...dailyBase, eq(usageReservations.userId, input.userId))),
        input.projectId === null
          ? Promise.resolve([])
          : transaction.select({
              committed: sql<number>`coalesce(sum(case when ${usageReservations.status} = 'RESERVED' then ${usageReservations.estimatedCreditUnits} when ${usageReservations.status} = 'RECONCILED' then ${usageReservations.actualCreditUnits} else 0 end), 0)::int`
            }).from(usageReservations).where(and(...dailyBase, eq(usageReservations.projectId, input.projectId)))
      ]);
      const organizationCommitted = organizationDaily?.committed ?? 0;
      const userCommitted = userDaily?.committed ?? 0;
      const projectCommitted = projectDailyRows[0]?.committed ?? 0;
      const effectiveDailyLimit = Math.min(policy.dailyCreditLimit, entitlementLimit(entitlementRows, 'MAX_DAILY_CREDITS'));
      const effectiveUserLimit = Math.min(policy.userDailyCreditLimit, entitlementLimit(entitlementRows, 'MAX_USER_DAILY_CREDITS'));
      const effectiveProjectLimit = Math.min(policy.projectDailyCreditLimit, entitlementLimit(entitlementRows, 'MAX_PROJECT_DAILY_CREDITS'));
      if (organizationCommitted + input.estimatedCreditUnits > effectiveDailyLimit) throw new DailyCreditLimitError();
      if (userCommitted + input.estimatedCreditUnits > effectiveUserLimit) throw new UserDailyCreditLimitError();
      if (input.projectId !== null && projectCommitted + input.estimatedCreditUnits > effectiveProjectLimit) {
        throw new ProjectDailyCreditLimitError();
      }
      if (balance.reservedCreditUnits + balance.consumedCreditUnits + input.estimatedCreditUnits > balance.allocatedCreditUnits) {
        throw new BudgetExhaustedError();
      }

      const [updatedBalance] = await transaction
        .update(creditBalances)
        .set({
          reservedCreditUnits: sql`${creditBalances.reservedCreditUnits} + ${input.estimatedCreditUnits}`,
          rowVersion: sql`${creditBalances.rowVersion} + 1`,
          updatedAt: now
        })
        .where(and(
          eq(creditBalances.organizationId, scope.organizationId),
          eq(creditBalances.id, balance.id),
          sql`${creditBalances.reservedCreditUnits} + ${creditBalances.consumedCreditUnits} + ${input.estimatedCreditUnits} <= ${creditBalances.allocatedCreditUnits}`
        ))
        .returning({ id: creditBalances.id });
      if (updatedBalance === undefined) throw new BudgetExhaustedError();

      const [created] = await transaction
        .insert(usageReservations)
        .values({
          id: input.reservationId,
          organizationId: scope.organizationId,
          creditBalanceId: balance.id,
          projectId: input.projectId,
          userId: input.userId,
          workflow: input.workflow,
          workflowVersion: input.workflowVersion,
          provider: input.provider,
          model: input.model,
          generationId: input.generationId,
          runId: input.runId,
          entitlementKey: 'AI_USAGE',
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          estimatedCreditUnits: input.estimatedCreditUnits,
          expiresAt: input.expiresAt
        })
        .returning();
      if (created === undefined) throw new Error('Usage reservation insert did not return a row');

      await transaction.insert(usageLedgerEntries).values({
        id: `ULED-${randomUUID()}`,
        organizationId: scope.organizationId,
        creditBalanceId: balance.id,
        reservationId: created.id,
        eventType: 'RESERVATION',
        reservedCreditUnits: input.estimatedCreditUnits,
        currency: subscription.currency,
        projectId: input.projectId,
        userId: input.userId,
        workflow: input.workflow,
        workflowVersion: input.workflowVersion,
        provider: input.provider,
        model: input.model,
        generationId: input.generationId,
        runId: input.runId,
        requestId: input.requestId
      });
      await transaction.insert(auditEvents).values({
        id: `AUDIT-${randomUUID()}`,
        organizationId: scope.organizationId,
        actorUserId: input.userId,
        action: 'USAGE_RESERVED',
        targetType: 'UsageReservation',
        targetId: created.id,
        requestId: input.requestId,
        metadata: {
          creditBalanceId: balance.id,
          estimatedCreditUnits: input.estimatedCreditUnits,
          workflow: input.workflow,
          provider: input.provider,
          model: input.model,
          runId: input.runId,
          sessionId: input.sessionId
        }
      });

      return reservationFromRow(created, false);
    });
  }

  async reconcileUsage(scope: BillingScope, input: ReconcileUsageInput) {
    return this.database.transaction(async (transaction) => {
      const [candidate] = await transaction
        .select()
        .from(usageReservations)
        .where(and(
          eq(usageReservations.organizationId, scope.organizationId),
          eq(usageReservations.id, input.reservationId)
        ))
        .limit(1);
      if (candidate === undefined) throw new UsageReservationNotFoundError();

      const [balance] = await transaction
        .select()
        .from(creditBalances)
        .where(and(
          eq(creditBalances.organizationId, scope.organizationId),
          eq(creditBalances.id, candidate.creditBalanceId)
        ))
        .limit(1)
        .for('update');
      if (balance === undefined) throw new Error('Usage reservation balance is missing');

      const [reservation] = await transaction
        .select()
        .from(usageReservations)
        .where(and(
          eq(usageReservations.organizationId, scope.organizationId),
          eq(usageReservations.id, input.reservationId),
          eq(usageReservations.creditBalanceId, balance.id)
        ))
        .limit(1)
        .for('update');
      if (reservation === undefined) throw new UsageReservationNotFoundError();
      if (reservation.status === 'RECONCILED') {
        if (reservation.reconciliationHash !== input.reconciliationHash) throw new UsageReconciliationConflictError();
        return reservationFromRow(reservation, true);
      }
      if (reservation.status === 'EXPIRED') throw new UsageReconciliationConflictError();
      if (new Date(reservation.expiresAt).getTime() <= Date.now()) throw new UsageReconciliationConflictError();
      if (input.actualCreditUnits > reservation.estimatedCreditUnits) throw new UsageReservationExceededError();

      const [reservationLedger] = await transaction
        .select({ currency: usageLedgerEntries.currency })
        .from(usageLedgerEntries)
        .where(and(
          eq(usageLedgerEntries.organizationId, scope.organizationId),
          eq(usageLedgerEntries.reservationId, reservation.id),
          eq(usageLedgerEntries.eventType, 'RESERVATION')
        ))
        .limit(1);
      if (reservationLedger === undefined) throw new Error('Usage reservation ledger entry is missing');
      if (reservationLedger.currency !== input.currency) throw new UsageReconciliationConflictError();

      if (balance.reservedCreditUnits < reservation.estimatedCreditUnits) {
        throw new Error('Usage reservation balance is inconsistent');
      }

      const occurredAt = new Date().toISOString();
      await transaction
        .update(creditBalances)
        .set({
          reservedCreditUnits: sql`${creditBalances.reservedCreditUnits} - ${reservation.estimatedCreditUnits}`,
          consumedCreditUnits: sql`${creditBalances.consumedCreditUnits} + ${input.actualCreditUnits}`,
          rowVersion: sql`${creditBalances.rowVersion} + 1`,
          updatedAt: occurredAt
        })
        .where(and(eq(creditBalances.organizationId, scope.organizationId), eq(creditBalances.id, balance.id)));

      const [updated] = await transaction
        .update(usageReservations)
        .set({
          actualCreditUnits: input.actualCreditUnits,
          status: 'RECONCILED',
          outcome: input.outcome,
          reconciliationHash: input.reconciliationHash,
          reconciledAt: occurredAt,
          updatedAt: occurredAt
        })
        .where(and(
          eq(usageReservations.organizationId, scope.organizationId),
          eq(usageReservations.id, reservation.id),
          eq(usageReservations.status, 'RESERVED')
        ))
        .returning();
      if (updated === undefined) throw new UsageReconciliationConflictError();

      await transaction.insert(usageLedgerEntries).values({
        id: `ULED-${randomUUID()}`,
        organizationId: scope.organizationId,
        creditBalanceId: balance.id,
        reservationId: reservation.id,
        eventType: 'RECONCILIATION',
        chargedCreditUnits: input.actualCreditUnits,
        releasedCreditUnits: reservation.estimatedCreditUnits - input.actualCreditUnits,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        toolChargeMicros: input.toolChargeMicros,
        providerCostMicros: input.providerCostMicros,
        currency: input.currency,
        outcome: input.outcome,
        retryCount: input.retryCount,
        fallbackUsed: input.fallbackUsed,
        cacheHit: input.cacheHit,
        projectId: reservation.projectId,
        userId: reservation.userId,
        workflow: reservation.workflow,
        workflowVersion: reservation.workflowVersion,
        provider: reservation.provider,
        model: reservation.model,
        generationId: reservation.generationId,
        runId: reservation.runId,
        requestId: input.requestId,
        occurredAt
      });
      await transaction.insert(auditEvents).values({
        id: `AUDIT-${randomUUID()}`,
        organizationId: scope.organizationId,
        actorUserId: input.actorUserId,
        action: 'USAGE_RECONCILED',
        targetType: 'UsageReservation',
        targetId: reservation.id,
        requestId: input.requestId,
        metadata: {
          estimatedCreditUnits: reservation.estimatedCreditUnits,
          actualCreditUnits: input.actualCreditUnits,
          outcome: input.outcome,
          retryCount: input.retryCount,
          fallbackUsed: input.fallbackUsed,
          cacheHit: input.cacheHit,
          runId: reservation.runId,
          sessionId: input.sessionId
        }
      });

      return reservationFromRow(updated, false);
    });
  }

  async updatePolicy(scope: BillingScope, input: UpdateBudgetPolicyInput) {
    return this.database.transaction(async (transaction) => {
      const now = new Date().toISOString();
      const [idempotency] = await transaction
        .insert(idempotencyRecords)
        .values({
          id: `IDEMP-${randomUUID()}`,
          organizationId: scope.organizationId,
          scope: 'BUDGET_POLICY_UPDATE',
          key: input.idempotencyKey,
          requestHash: input.requestHash,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString()
        })
        .onConflictDoNothing()
        .returning({ id: idempotencyRecords.id });

      if (idempotency === undefined) {
        const [existing] = await transaction
          .select()
          .from(idempotencyRecords)
          .where(and(
            eq(idempotencyRecords.organizationId, scope.organizationId),
            eq(idempotencyRecords.scope, 'BUDGET_POLICY_UPDATE'),
            eq(idempotencyRecords.key, input.idempotencyKey)
          ))
          .limit(1)
          .for('update');
        if (existing === undefined || existing.requestHash !== input.requestHash) {
          throw new BudgetPolicyIdempotencyConflictError();
        }
        if (existing.status === 'COMPLETED' && existing.responsePayload !== null) {
          const replay = BudgetPolicySchema.parse(existing.responsePayload);
          return { ...replay, replayed: true };
        }
        throw new BudgetPolicyUpdateInProgressError();
      }

      const [subscription] = await transaction
        .select({ id: subscriptions.id, planId: subscriptions.planId })
        .from(subscriptions)
        .where(and(
          eq(subscriptions.organizationId, scope.organizationId),
          inArray(subscriptions.status, ['TRIALING', 'ACTIVE', 'PAST_DUE']),
          lte(subscriptions.billingPeriodStart, now),
          gt(subscriptions.billingPeriodEnd, now)
        ))
        .limit(1);
      if (subscription === undefined) throw new BillingNotProvisionedError();

      const [balance] = await transaction
        .select()
        .from(creditBalances)
        .where(and(
          eq(creditBalances.organizationId, scope.organizationId),
          eq(creditBalances.subscriptionId, subscription.id),
          lte(creditBalances.periodStart, now),
          gt(creditBalances.periodEnd, now)
        ))
        .limit(1)
        .for('update');
      if (balance === undefined) throw new BillingNotProvisionedError();

      const [policy] = await transaction
        .select()
        .from(budgetPolicies)
        .where(and(eq(budgetPolicies.organizationId, scope.organizationId), eq(budgetPolicies.id, input.policyId)))
        .limit(1)
        .for('update');
      if (policy === undefined) throw new BillingNotProvisionedError();
      if (policy.rowVersion !== input.expectedRowVersion) throw new BudgetPolicyVersionConflictError();

      const entitlementRows = await transaction
        .select({ key: planEntitlements.key, enabled: planEntitlements.enabled, integerLimit: planEntitlements.integerLimit })
        .from(planEntitlements)
        .where(eq(planEntitlements.planId, subscription.planId));
      const maximumDaily = Math.min(balance.allocatedCreditUnits, entitlementLimit(entitlementRows, 'MAX_DAILY_CREDITS'));
      const maximumUserDaily = Math.min(maximumDaily, entitlementLimit(entitlementRows, 'MAX_USER_DAILY_CREDITS'));
      const maximumProjectDaily = Math.min(maximumDaily, entitlementLimit(entitlementRows, 'MAX_PROJECT_DAILY_CREDITS'));
      if (
        input.dailyCreditLimit > maximumDaily ||
        input.userDailyCreditLimit > maximumUserDaily ||
        input.projectDailyCreditLimit > maximumProjectDaily ||
        input.userDailyCreditLimit > input.dailyCreditLimit ||
        input.projectDailyCreditLimit > input.dailyCreditLimit
      ) {
        throw new BudgetPolicyLimitError();
      }

      const [updated] = await transaction
        .update(budgetPolicies)
        .set({
          dailyCreditLimit: input.dailyCreditLimit,
          userDailyCreditLimit: input.userDailyCreditLimit,
          projectDailyCreditLimit: input.projectDailyCreditLimit,
          alertThresholdPercent: input.alertThresholdPercent,
          rowVersion: sql`${budgetPolicies.rowVersion} + 1`,
          updatedAt: now
        })
        .where(and(
          eq(budgetPolicies.organizationId, scope.organizationId),
          eq(budgetPolicies.id, policy.id),
          eq(budgetPolicies.rowVersion, input.expectedRowVersion)
        ))
        .returning();
      if (updated === undefined) throw new BudgetPolicyVersionConflictError();

      await transaction.update(creditBalances)
        .set({ alertThresholdPercent: input.alertThresholdPercent, updatedAt: now })
        .where(and(eq(creditBalances.organizationId, scope.organizationId), eq(creditBalances.id, balance.id)));

      const response = policyFromRow(updated, false);
      await transaction.insert(auditEvents).values({
        id: `AUDIT-${randomUUID()}`,
        organizationId: scope.organizationId,
        actorUserId: input.actorUserId,
        action: 'BUDGET_POLICY_UPDATED',
        targetType: 'BudgetPolicy',
        targetId: policy.id,
        requestId: input.requestId,
        metadata: {
          previous: {
            dailyCreditLimit: policy.dailyCreditLimit,
            userDailyCreditLimit: policy.userDailyCreditLimit,
            projectDailyCreditLimit: policy.projectDailyCreditLimit,
            alertThresholdPercent: policy.alertThresholdPercent,
            rowVersion: policy.rowVersion
          },
          current: {
            dailyCreditLimit: response.dailyCreditLimit,
            userDailyCreditLimit: response.userDailyCreditLimit,
            projectDailyCreditLimit: response.projectDailyCreditLimit,
            alertThresholdPercent: response.alertThresholdPercent,
            rowVersion: response.rowVersion
          },
          sessionId: input.sessionId
        }
      });
      await transaction.update(idempotencyRecords)
        .set({ status: 'COMPLETED', responseStatus: 200, responsePayload: response, updatedAt: now })
        .where(eq(idempotencyRecords.id, idempotency.id));

      return response;
    });
  }

  async recoverExpiredReservations(scope: BillingScope, input: RecoverExpiredReservationsInput) {
    return this.database.transaction(async (transaction) => {
      const occurredAt = new Date().toISOString();
      const [subscription] = await transaction
        .select({ id: subscriptions.id, currency: plans.currency })
        .from(subscriptions)
        .innerJoin(plans, eq(plans.id, subscriptions.planId))
        .where(and(
          eq(subscriptions.organizationId, scope.organizationId),
          inArray(subscriptions.status, ['TRIALING', 'ACTIVE', 'PAST_DUE']),
          lte(subscriptions.billingPeriodStart, occurredAt),
          gt(subscriptions.billingPeriodEnd, occurredAt)
        ))
        .limit(1);
      if (subscription === undefined) throw new BillingNotProvisionedError();

      const [balance] = await transaction
        .select()
        .from(creditBalances)
        .where(and(
          eq(creditBalances.organizationId, scope.organizationId),
          eq(creditBalances.subscriptionId, subscription.id),
          lte(creditBalances.periodStart, occurredAt),
          gt(creditBalances.periodEnd, occurredAt)
        ))
        .limit(1)
        .for('update');
      if (balance === undefined) throw new BillingNotProvisionedError();

      const expired = await transaction
        .select()
        .from(usageReservations)
        .where(and(
          eq(usageReservations.organizationId, scope.organizationId),
          eq(usageReservations.creditBalanceId, balance.id),
          eq(usageReservations.status, 'RESERVED'),
          lte(usageReservations.expiresAt, occurredAt)
        ))
        .for('update');
      if (expired.length === 0) {
        return ExpiredReservationRecoverySchema.parse({ releasedReservations: 0, releasedCreditUnits: 0 });
      }

      const releasedCreditUnits = expired.reduce((total, reservation) => total + reservation.estimatedCreditUnits, 0);
      if (balance.reservedCreditUnits < releasedCreditUnits) throw new Error('Expired reservation balance is inconsistent');
      const expirationHash = createHash('sha256')
        .update(JSON.stringify({ organizationId: scope.organizationId, reservationIds: expired.map((item) => item.id).sort() }), 'utf8')
        .digest('hex');

      await transaction.update(creditBalances)
        .set({
          reservedCreditUnits: sql`${creditBalances.reservedCreditUnits} - ${releasedCreditUnits}`,
          rowVersion: sql`${creditBalances.rowVersion} + 1`,
          updatedAt: occurredAt
        })
        .where(and(eq(creditBalances.organizationId, scope.organizationId), eq(creditBalances.id, balance.id)));
      await transaction.update(usageReservations)
        .set({
          actualCreditUnits: 0,
          status: 'EXPIRED',
          outcome: 'CANCELLED',
          reconciliationHash: expirationHash,
          reconciledAt: occurredAt,
          updatedAt: occurredAt
        })
        .where(and(
          eq(usageReservations.organizationId, scope.organizationId),
          inArray(usageReservations.id, expired.map((item) => item.id)),
          eq(usageReservations.status, 'RESERVED')
        ));

      await transaction.insert(usageLedgerEntries).values(expired.map((reservation) => ({
        id: `ULED-${randomUUID()}`,
        organizationId: scope.organizationId,
        creditBalanceId: balance.id,
        reservationId: reservation.id,
        eventType: 'EXPIRATION',
        releasedCreditUnits: reservation.estimatedCreditUnits,
        currency: subscription.currency,
        outcome: 'CANCELLED',
        projectId: reservation.projectId,
        userId: reservation.userId,
        workflow: reservation.workflow,
        workflowVersion: reservation.workflowVersion,
        provider: reservation.provider,
        model: reservation.model,
        generationId: reservation.generationId,
        runId: reservation.runId,
        requestId: input.requestId,
        occurredAt
      })));
      await transaction.insert(auditEvents).values(expired.map((reservation) => ({
        id: `AUDIT-${randomUUID()}`,
        organizationId: scope.organizationId,
        actorUserId: input.actorUserId,
        action: 'USAGE_RESERVATION_EXPIRED',
        targetType: 'UsageReservation',
        targetId: reservation.id,
        requestId: input.requestId,
        metadata: {
          estimatedCreditUnits: reservation.estimatedCreditUnits,
          expiresAt: iso(reservation.expiresAt),
          runId: reservation.runId,
          sessionId: input.sessionId,
          recovery: input.actorUserId === null ? 'SYSTEM' : 'AUTHORIZED_USER'
        }
      })));

      return ExpiredReservationRecoverySchema.parse({
        releasedReservations: expired.length,
        releasedCreditUnits
      });
    });
  }
}
