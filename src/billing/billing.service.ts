import { createHash, randomUUID } from 'node:crypto';

import { BadRequestException, ConflictException, HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';

import type { OrganizationAccessContext } from '../identity/identity.schema';
import {
  BillingOverviewSchema,
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

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/u;

function expectedPolicyRowVersion(value: unknown, policyId: string): number {
  if (value === undefined) throw new HttpException('If-Match header is required', 428);
  if (typeof value !== 'string') throw new BadRequestException('If-Match header is invalid for this budget policy');
  const match = /^"(BPOL-[A-Za-z0-9_-]{1,123}):([1-9][0-9]*)"$/u.exec(value);
  if (match === null || match[1] !== policyId) throw new BadRequestException('If-Match header is invalid for this budget policy');
  const rowVersion = Number(match[2]);
  if (!Number.isSafeInteger(rowVersion)) throw new BadRequestException('If-Match header is invalid for this budget policy');
  return rowVersion;
}

export function budgetPolicyEtag(policy: Pick<BudgetPolicy, 'id' | 'rowVersion'>): string {
  return `"${policy.id}:${policy.rowVersion}"`;
}

@Injectable()
export class BillingService {
  constructor(@Inject(BILLING_REPOSITORY) private readonly repository: BillingRepository) {}

  async getOverview(context: OrganizationAccessContext): Promise<BillingOverview> {
    const overview = await this.repository.getOverview({ organizationId: context.organizationId });
    if (overview === null) throw new NotFoundException('Billing is not provisioned for this organization');
    return BillingOverviewSchema.parse(overview);
  }

  async reserveUsage(
    context: OrganizationAccessContext,
    input: unknown,
    requestId: string
  ): Promise<UsageReservation> {
    const request = ReserveUsageRequestSchema.safeParse(input);
    if (!request.success) throw new BadRequestException('Usage reservation request is invalid');
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
        throw new NotFoundException(cause.message);
      }
      if (cause instanceof BillingEntitlementError || cause instanceof BudgetExhaustedError || cause instanceof RequestCreditLimitError || cause instanceof DailyCreditLimitError || cause instanceof UserDailyCreditLimitError || cause instanceof ProjectDailyCreditLimitError) {
        throw new HttpException(cause.message, 402);
      }
      if (cause instanceof UsageIdempotencyConflictError) throw new ConflictException(cause.message);
      throw cause;
    }
  }

  async reconcileUsage(
    context: OrganizationAccessContext,
    input: unknown,
    requestId: string
  ): Promise<UsageReservation> {
    const request = ReconcileUsageRequestSchema.safeParse(input);
    if (!request.success) throw new BadRequestException('Usage reconciliation request is invalid');
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
      if (cause instanceof UsageReservationNotFoundError) throw new NotFoundException(cause.message);
      if (cause instanceof UsageReservationExceededError || cause instanceof UsageReconciliationConflictError) {
        throw new ConflictException(cause.message);
      }
      throw cause;
    }
  }

  async updatePolicy(
    context: OrganizationAccessContext,
    input: unknown,
    policyId: string,
    ifMatchInput: unknown,
    idempotencyKeyInput: unknown,
    requestId: string
  ): Promise<BudgetPolicy> {
    const request = UpdateBudgetPolicyRequestSchema.safeParse(input);
    if (!request.success) throw new BadRequestException('Budget policy update is invalid');
    if (typeof idempotencyKeyInput !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(idempotencyKeyInput)) {
      throw new BadRequestException('A valid Idempotency-Key header is required');
    }
    const expectedRowVersion = expectedPolicyRowVersion(ifMatchInput, policyId);
    const requestHash = stableHash({ policyId, expectedRowVersion, ...request.data });

    try {
      const policy = await this.repository.updatePolicy(
        { organizationId: context.organizationId },
        {
          ...request.data,
          policyId,
          expectedRowVersion,
          idempotencyKey: idempotencyKeyInput,
          requestHash,
          requestId,
          actorUserId: context.userId,
          sessionId: context.sessionId
        }
      );
      return BudgetPolicySchema.parse(policy);
    } catch (cause) {
      if (cause instanceof BillingNotProvisionedError) throw new NotFoundException(cause.message);
      if (cause instanceof BudgetPolicyLimitError) throw new BadRequestException(cause.message);
      if (cause instanceof BudgetPolicyVersionConflictError) {
        throw new HttpException(cause.message, HttpStatus.PRECONDITION_FAILED);
      }
      if (cause instanceof BudgetPolicyIdempotencyConflictError || cause instanceof BudgetPolicyUpdateInProgressError) {
        throw new ConflictException(cause.message);
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
      if (cause instanceof BillingNotProvisionedError) throw new NotFoundException(cause.message);
      throw cause;
    }
  }
}
