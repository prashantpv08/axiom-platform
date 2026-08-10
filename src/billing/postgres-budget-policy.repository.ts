import { randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, inArray, lte, sql } from 'drizzle-orm';

import type { AxiomDatabase } from '../database/client';
import { DATABASE } from '../database/database.module';
import {
  claimPostgresIdempotency,
  completePostgresIdempotency
} from '../database/idempotency/postgres-idempotency';
import {
  auditEvents,
  budgetPolicies,
  creditBalances,
  planEntitlements,
  subscriptions
} from '../database/schema';
import {
  BillingNotProvisionedError,
  BudgetPolicyIdempotencyConflictError,
  BudgetPolicyLimitError,
  BudgetPolicyUpdateInProgressError,
  BudgetPolicyVersionConflictError,
  type BillingScope,
  type UpdateBudgetPolicyInput
} from './billing.repository';
import { BudgetPolicySchema } from './billing.schema';
import { entitlementLimit, iso } from './postgres-billing.persistence';

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

@Injectable()
export class PostgresBudgetPolicyRepository {
  constructor(@Inject(DATABASE) private readonly database: AxiomDatabase) {}

  async updatePolicy(scope: BillingScope, input: UpdateBudgetPolicyInput) {
    return this.database.transaction(async (transaction) => {
      const now = new Date().toISOString();
      const idempotency = await claimPostgresIdempotency(transaction, {
        organizationId: scope.organizationId,
        scope: 'BUDGET_POLICY_UPDATE',
        key: input.idempotencyKey,
        requestHash: input.requestHash
      });
      if (idempotency.kind === 'HASH_CONFLICT') throw new BudgetPolicyIdempotencyConflictError();
      if (idempotency.kind === 'REPLAY') {
        const replay = BudgetPolicySchema.parse(idempotency.responsePayload);
        return { ...replay, replayed: true };
      }
      if (idempotency.kind === 'IN_PROGRESS') throw new BudgetPolicyUpdateInProgressError();

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
      await completePostgresIdempotency(transaction, {
        recordId: idempotency.recordId,
        responseStatus: 200,
        responsePayload: response,
        completedAt: now
      });

      return response;
    });
  }
}
