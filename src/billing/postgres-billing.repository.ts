import { Inject, Injectable } from '@nestjs/common';

import type {
  BillingRepository,
  BillingScope,
  ReconcileUsageInput,
  RecoverExpiredReservationsInput,
  ReserveUsageInput,
  UpdateBudgetPolicyInput
} from './billing.repository';
import { PostgresBillingOverviewQuery } from './postgres-billing-overview.query';
import { PostgresBudgetPolicyRepository } from './postgres-budget-policy.repository';
import { PostgresUsageAccountingRepository } from './postgres-usage-accounting.repository';

@Injectable()
export class PostgresBillingRepository implements BillingRepository {
  constructor(
    @Inject(PostgresBillingOverviewQuery) private readonly overviewQuery: PostgresBillingOverviewQuery,
    @Inject(PostgresUsageAccountingRepository) private readonly usageAccounting: PostgresUsageAccountingRepository,
    @Inject(PostgresBudgetPolicyRepository) private readonly budgetPolicy: PostgresBudgetPolicyRepository
  ) {}

  getOverview(scope: BillingScope) {
    return this.overviewQuery.getOverview(scope);
  }

  reserveUsage(scope: BillingScope, input: ReserveUsageInput) {
    return this.usageAccounting.reserveUsage(scope, input);
  }

  reconcileUsage(scope: BillingScope, input: ReconcileUsageInput) {
    return this.usageAccounting.reconcileUsage(scope, input);
  }

  updatePolicy(scope: BillingScope, input: UpdateBudgetPolicyInput) {
    return this.budgetPolicy.updatePolicy(scope, input);
  }

  recoverExpiredReservations(scope: BillingScope, input: RecoverExpiredReservationsInput) {
    return this.usageAccounting.recoverExpiredReservations(scope, input);
  }
}
