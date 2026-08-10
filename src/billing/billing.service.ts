import { createHash, randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type { OrganizationAccessContext } from '../identity/identity.schema';
import { ApplicationError } from '../platform/application/application-error';
import {
  BillingOverviewSchema,
  BillingIdempotencyKeySchema,
  BudgetPolicySchema,
  ExpiredReservationRecoverySchema,
  ReconcileUsageRequestSchema,
  ReserveUsageRequestSchema,
  UpdateBudgetPolicyRequestSchema,
  type BillingOverview,
  type BudgetPolicy,
  type ExpiredReservationRecovery,
  type UsageReservation
} from './billing.schema';
import {
  BILLING_REPOSITORY,
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
  type BillingRepository
} from './billing.repository';

function stableHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

@Injectable()
export class BillingService {
  constructor(@Inject(BILLING_REPOSITORY) private readonly repository: BillingRepository) {}

  async getOverview(context: OrganizationAccessContext): Promise<BillingOverview> {
    const overview = await this.repository.getOverview({ organizationId: context.organizationId });
    if (overview === null) throw new ApplicationError('NOT_FOUND', 'Billing is not provisioned for this organization');
    return BillingOverviewSchema.parse(overview);
  }

  async reserveUsage(
    context: OrganizationAccessContext,
    input: unknown,
    requestId: string
  ): Promise<UsageReservation> {
    const request = ReserveUsageRequestSchema.safeParse(input);
    if (!request.success) throw new ApplicationError('INVALID_REQUEST', 'Usage reservation request is invalid');
    const expiresAt = new Date(Date.now() + request.data.expiresInSeconds * 1_000).toISOString();
    const hashInput = { ...request.data, userId: context.userId };

    try {
      return await this.repository.reserveUsage(
        { organizationId: context.organizationId },
        {
          reservationId: `URES-${randomUUID()}`,
          ...request.data,
          userId: context.userId,
          expiresAt,
          requestHash: stableHash(hashInput),
          requestId,
          sessionId: context.sessionId
        }
      );
    } catch (cause) {
      if (cause instanceof BillingNotProvisionedError || cause instanceof UsageAttributionError) {
        throw new ApplicationError('NOT_FOUND', cause.message);
      }
      if (cause instanceof BillingEntitlementError || cause instanceof BudgetExhaustedError || cause instanceof RequestCreditLimitError || cause instanceof DailyCreditLimitError || cause instanceof UserDailyCreditLimitError || cause instanceof ProjectDailyCreditLimitError) {
        throw new ApplicationError('PAYMENT_REQUIRED', cause.message);
      }
      if (cause instanceof UsageIdempotencyConflictError) throw new ApplicationError('CONFLICT', cause.message);
      throw cause;
    }
  }

  async reconcileUsage(
    context: OrganizationAccessContext,
    input: unknown,
    requestId: string
  ): Promise<UsageReservation> {
    const request = ReconcileUsageRequestSchema.safeParse(input);
    if (!request.success) throw new ApplicationError('INVALID_REQUEST', 'Usage reconciliation request is invalid');
    const reconciliationHash = stableHash(request.data);

    try {
      return await this.repository.reconcileUsage(
        { organizationId: context.organizationId },
        {
          ...request.data,
          reconciliationHash,
          requestId,
          actorUserId: context.userId,
          sessionId: context.sessionId
        }
      );
    } catch (cause) {
      if (cause instanceof UsageReservationNotFoundError) throw new ApplicationError('NOT_FOUND', cause.message);
      if (cause instanceof UsageReservationExceededError || cause instanceof UsageReconciliationConflictError) {
        throw new ApplicationError('CONFLICT', cause.message);
      }
      throw cause;
    }
  }

  async updatePolicy(
    context: OrganizationAccessContext,
    input: unknown,
    policyId: string,
    expectedRowVersion: number,
    idempotencyKeyInput: unknown,
    requestId: string
  ): Promise<BudgetPolicy> {
    const request = UpdateBudgetPolicyRequestSchema.safeParse(input);
    if (!request.success) throw new ApplicationError('INVALID_REQUEST', 'Budget policy update is invalid');
    const idempotencyKey = BillingIdempotencyKeySchema.safeParse(idempotencyKeyInput);
    if (!idempotencyKey.success) {
      throw new ApplicationError('INVALID_REQUEST', 'A valid Idempotency-Key header is required');
    }
    const requestHash = stableHash({ policyId, expectedRowVersion, ...request.data });

    try {
      const policy = await this.repository.updatePolicy(
        { organizationId: context.organizationId },
        {
          ...request.data,
          policyId,
          expectedRowVersion,
          idempotencyKey: idempotencyKey.data,
          requestHash,
          requestId,
          actorUserId: context.userId,
          sessionId: context.sessionId
        }
      );
      return BudgetPolicySchema.parse(policy);
    } catch (cause) {
      if (cause instanceof BillingNotProvisionedError) throw new ApplicationError('NOT_FOUND', cause.message);
      if (cause instanceof BudgetPolicyLimitError) throw new ApplicationError('INVALID_REQUEST', cause.message);
      if (cause instanceof BudgetPolicyVersionConflictError) {
        throw new ApplicationError('PRECONDITION_FAILED', cause.message);
      }
      if (cause instanceof BudgetPolicyIdempotencyConflictError || cause instanceof BudgetPolicyUpdateInProgressError) {
        throw new ApplicationError('CONFLICT', cause.message);
      }
      throw cause;
    }
  }

  async recoverExpiredReservations(
    context: OrganizationAccessContext,
    requestId: string
  ): Promise<ExpiredReservationRecovery> {
    try {
      const result = await this.repository.recoverExpiredReservations(
        { organizationId: context.organizationId },
        { requestId, actorUserId: context.userId, sessionId: context.sessionId }
      );
      return ExpiredReservationRecoverySchema.parse(result);
    } catch (cause) {
      if (cause instanceof BillingNotProvisionedError) throw new ApplicationError('NOT_FOUND', cause.message);
      throw cause;
    }
  }
}
