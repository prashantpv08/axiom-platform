import type { BillingOverview, BudgetPolicy, ExpiredReservationRecovery, UsageReservation } from './billing.schema';

export const BILLING_REPOSITORY = Symbol('AXIOM_BILLING_REPOSITORY');

export type BillingScope = Readonly<{ organizationId: string }>;

export type UsageAttribution = {
  projectId: string | null;
  userId: string;
  workflow: string;
  workflowVersion: string;
  provider: string;
  model: string;
  generationId: string | null;
  runId: string;
};

export type ReserveUsageInput = UsageAttribution & {
  reservationId: string;
  estimatedCreditUnits: number;
  expiresAt: string;
  idempotencyKey: string;
  requestHash: string;
  requestId: string;
  sessionId: string;
};

export type ReconcileUsageInput = {
  reservationId: string;
  actualCreditUnits: number;
  inputTokens: number;
  outputTokens: number;
  toolChargeMicros: number;
  providerCostMicros: number;
  currency: string;
  outcome: 'SUCCEEDED' | 'FAILED' | 'CANCELLED' | 'CACHED';
  retryCount: number;
  fallbackUsed: boolean;
  cacheHit: boolean;
  reconciliationHash: string;
  requestId: string;
  actorUserId: string;
  sessionId: string;
};

export type UpdateBudgetPolicyInput = {
  policyId: string;
  dailyCreditLimit: number;
  userDailyCreditLimit: number;
  projectDailyCreditLimit: number;
  alertThresholdPercent: number;
  expectedRowVersion: number;
  idempotencyKey: string;
  requestHash: string;
  requestId: string;
  actorUserId: string;
  sessionId: string;
};

export type RecoverExpiredReservationsInput = {
  requestId: string;
  actorUserId: string | null;
  sessionId: string | null;
};

export class BillingNotProvisionedError extends Error {
  constructor() { super('Billing is not provisioned for this organization'); this.name = 'BillingNotProvisionedError'; }
}
export class BillingEntitlementError extends Error {
  constructor() { super('AI usage is not enabled for this organization'); this.name = 'BillingEntitlementError'; }
}
export class RequestCreditLimitError extends Error {
  constructor() { super('The request exceeds the plan credit limit'); this.name = 'RequestCreditLimitError'; }
}
export class BudgetExhaustedError extends Error {
  constructor() { super('The organization does not have enough available credits'); this.name = 'BudgetExhaustedError'; }
}
export class DailyCreditLimitError extends Error {
  constructor() { super('The organization daily credit limit is exhausted'); this.name = 'DailyCreditLimitError'; }
}
export class UserDailyCreditLimitError extends Error {
  constructor() { super('The user daily credit limit is exhausted'); this.name = 'UserDailyCreditLimitError'; }
}
export class ProjectDailyCreditLimitError extends Error {
  constructor() { super('The project daily credit limit is exhausted'); this.name = 'ProjectDailyCreditLimitError'; }
}
export class BudgetPolicyLimitError extends Error {
  constructor() { super('The requested policy exceeds plan or billing-period limits'); this.name = 'BudgetPolicyLimitError'; }
}
export class BudgetPolicyVersionConflictError extends Error {
  constructor() { super('The budget policy changed since it was loaded'); this.name = 'BudgetPolicyVersionConflictError'; }
}
export class BudgetPolicyIdempotencyConflictError extends Error {
  constructor() { super('Budget policy idempotency key was already used for different input'); this.name = 'BudgetPolicyIdempotencyConflictError'; }
}
export class BudgetPolicyUpdateInProgressError extends Error {
  constructor() { super('Budget policy update with this idempotency key is still processing'); this.name = 'BudgetPolicyUpdateInProgressError'; }
}
export class UsageIdempotencyConflictError extends Error {
  constructor() { super('Usage idempotency key was already used for different input'); this.name = 'UsageIdempotencyConflictError'; }
}
export class UsageReservationNotFoundError extends Error {
  constructor() { super('Usage reservation was not found'); this.name = 'UsageReservationNotFoundError'; }
}
export class UsageReservationExceededError extends Error {
  constructor() { super('Actual usage exceeds the approved reservation'); this.name = 'UsageReservationExceededError'; }
}
export class UsageReconciliationConflictError extends Error {
  constructor() { super('Usage reservation was already reconciled with different measurements'); this.name = 'UsageReconciliationConflictError'; }
}
export class UsageAttributionError extends Error {
  constructor() { super('Usage attribution is outside the organization boundary'); this.name = 'UsageAttributionError'; }
}

export interface BillingRepository {
  getOverview(scope: BillingScope): Promise<BillingOverview | null>;
  reserveUsage(scope: BillingScope, input: ReserveUsageInput): Promise<UsageReservation>;
  reconcileUsage(scope: BillingScope, input: ReconcileUsageInput): Promise<UsageReservation>;
  updatePolicy(scope: BillingScope, input: UpdateBudgetPolicyInput): Promise<BudgetPolicy>;
  recoverExpiredReservations(scope: BillingScope, input: RecoverExpiredReservationsInput): Promise<ExpiredReservationRecovery>;
}
