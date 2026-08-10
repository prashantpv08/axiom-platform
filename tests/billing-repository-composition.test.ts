import { describe, expect, it, vi } from 'vitest';

import type {
  BillingScope,
  ReconcileUsageInput,
  RecoverExpiredReservationsInput,
  ReserveUsageInput,
  UpdateBudgetPolicyInput
} from '../src/billing/billing.repository';
import type {
  BillingOverview,
  BudgetPolicy,
  ExpiredReservationRecovery,
  UsageReservation
} from '../src/billing/billing.schema';
import { PostgresBillingRepository } from '../src/billing/postgres-billing.repository';
import type { PostgresBillingOverviewQuery } from '../src/billing/postgres-billing-overview.query';
import type { PostgresBudgetPolicyRepository } from '../src/billing/postgres-budget-policy.repository';
import type { PostgresUsageAccountingRepository } from '../src/billing/postgres-usage-accounting.repository';

const scope: BillingScope = { organizationId: 'ORG-SEAM' };

function composition() {
  const overviewQuery = { getOverview: vi.fn() };
  const usageAccounting = {
    reserveUsage: vi.fn(),
    reconcileUsage: vi.fn(),
    recoverExpiredReservations: vi.fn()
  };
  const budgetPolicy = { updatePolicy: vi.fn() };
  const repository = new PostgresBillingRepository(
    overviewQuery as unknown as PostgresBillingOverviewQuery,
    usageAccounting as unknown as PostgresUsageAccountingRepository,
    budgetPolicy as unknown as PostgresBudgetPolicyRepository
  );
  return { budgetPolicy, overviewQuery, repository, usageAccounting };
}

describe('PostgresBillingRepository composition seam', () => {
  it('delegates the overview read without altering its scope or result', async () => {
    const { overviewQuery, repository } = composition();
    const expected = { plan: { id: 'PLAN-SEAM' } } as BillingOverview;
    overviewQuery.getOverview.mockResolvedValue(expected);

    await expect(repository.getOverview(scope)).resolves.toBe(expected);
    expect(overviewQuery.getOverview).toHaveBeenCalledOnce();
    expect(overviewQuery.getOverview).toHaveBeenCalledWith(scope);
  });

  it('delegates all usage-accounting operations to the same component', async () => {
    const { repository, usageAccounting } = composition();
    const reserveInput = { reservationId: 'URES-SEAM' } as ReserveUsageInput;
    const reconcileInput = { reservationId: 'URES-SEAM' } as ReconcileUsageInput;
    const recoveryInput = { requestId: 'REQ-SEAM' } as RecoverExpiredReservationsInput;
    const reservation = { id: 'URES-SEAM' } as UsageReservation;
    const recovery = { releasedReservations: 0, releasedCreditUnits: 0 } as ExpiredReservationRecovery;
    usageAccounting.reserveUsage.mockResolvedValue(reservation);
    usageAccounting.reconcileUsage.mockResolvedValue(reservation);
    usageAccounting.recoverExpiredReservations.mockResolvedValue(recovery);

    await expect(repository.reserveUsage(scope, reserveInput)).resolves.toBe(reservation);
    await expect(repository.reconcileUsage(scope, reconcileInput)).resolves.toBe(reservation);
    await expect(repository.recoverExpiredReservations(scope, recoveryInput)).resolves.toBe(recovery);
    expect(usageAccounting.reserveUsage).toHaveBeenCalledWith(scope, reserveInput);
    expect(usageAccounting.reconcileUsage).toHaveBeenCalledWith(scope, reconcileInput);
    expect(usageAccounting.recoverExpiredReservations).toHaveBeenCalledWith(scope, recoveryInput);
  });

  it('delegates budget-policy updates without altering concurrency or idempotency input', async () => {
    const { budgetPolicy, repository } = composition();
    const input = {
      policyId: 'BPOL-SEAM',
      expectedRowVersion: 7,
      idempotencyKey: 'policy-seam-key'
    } as UpdateBudgetPolicyInput;
    const expected = { id: 'BPOL-SEAM', rowVersion: 8 } as BudgetPolicy;
    budgetPolicy.updatePolicy.mockResolvedValue(expected);

    await expect(repository.updatePolicy(scope, input)).resolves.toBe(expected);
    expect(budgetPolicy.updatePolicy).toHaveBeenCalledOnce();
    expect(budgetPolicy.updatePolicy).toHaveBeenCalledWith(scope, input);
  });
});
