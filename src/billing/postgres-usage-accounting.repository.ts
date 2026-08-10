import { createHash, randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, gte, inArray, lte, sql } from 'drizzle-orm';

import type { AxiomDatabase } from '../database/client';
import { DATABASE } from '../database/database.module';
import {
  auditEvents,
  budgetPolicies,
  creditBalances,
  memberships,
  planEntitlements,
  plans,
  projects,
  subscriptions,
  usageLedgerEntries,
  usageReservations
} from '../database/schema';
import {
  BillingEntitlementError,
  BillingNotProvisionedError,
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
  type BillingScope,
  type ReconcileUsageInput,
  type RecoverExpiredReservationsInput,
  type ReserveUsageInput
} from './billing.repository';
import { ExpiredReservationRecoverySchema, UsageReservationSchema } from './billing.schema';
import { dayStartUtc, entitlementLimit, iso } from './postgres-billing.persistence';

type ReservationRow = typeof usageReservations.$inferSelect;

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

@Injectable()
export class PostgresUsageAccountingRepository {
  constructor(@Inject(DATABASE) private readonly database: AxiomDatabase) {}

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
