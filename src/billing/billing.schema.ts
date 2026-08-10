import { z } from 'zod';

import { UserIdSchema } from '../identity/identity.schema';
import { ProjectIdSchema } from '../projects/project.schema';

export const PlanIdSchema = z.string().regex(/^PLAN-[A-Za-z0-9_-]{1,123}$/u);
export const SubscriptionIdSchema = z.string().regex(/^SUB-[A-Za-z0-9_-]{1,124}$/u);
export const CreditBalanceIdSchema = z.string().regex(/^BAL-[A-Za-z0-9_-]{1,124}$/u);
export const UsageReservationIdSchema = z.string().regex(/^URES-[A-Za-z0-9_-]{1,123}$/u);
export const UsageLedgerEntryIdSchema = z.string().regex(/^ULED-[A-Za-z0-9_-]{1,123}$/u);
export const BudgetPolicyIdSchema = z.string().regex(/^BPOL-[A-Za-z0-9_-]{1,123}$/u);
export const BillingIdempotencyKeySchema = z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/u);
export const ProductCreditUnitsSchema = z.number().int().min(0).max(2_000_000_000);
export const CurrencySchema = z.string().regex(/^[A-Z]{3}$/u);
export const UsageOutcomeSchema = z.enum(['SUCCEEDED', 'FAILED', 'CANCELLED', 'CACHED']);

export const ReserveUsageRequestSchema = z.object({
  projectId: ProjectIdSchema.nullable().default(null),
  workflow: z.string().trim().min(2).max(100),
  workflowVersion: z.string().trim().min(1).max(100),
  provider: z.string().trim().min(1).max(100),
  model: z.string().trim().min(1).max(200),
  generationId: z.string().trim().min(1).max(160).nullable().default(null),
  runId: z.string().trim().min(1).max(160),
  estimatedCreditUnits: ProductCreditUnitsSchema.positive(),
  expiresInSeconds: z.number().int().min(60).max(86_400).default(3_600),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9._:-]{8,128}$/u)
}).strict();

export const ReconcileUsageRequestSchema = z.object({
  reservationId: UsageReservationIdSchema,
  actualCreditUnits: ProductCreditUnitsSchema,
  inputTokens: z.number().int().min(0).max(2_000_000_000),
  outputTokens: z.number().int().min(0).max(2_000_000_000),
  toolChargeMicros: z.number().int().min(0).max(2_000_000_000),
  providerCostMicros: z.number().int().min(0).max(2_000_000_000),
  currency: CurrencySchema,
  outcome: UsageOutcomeSchema,
  retryCount: z.number().int().min(0).max(1_000),
  fallbackUsed: z.boolean(),
  cacheHit: z.boolean()
}).strict();

export const UsageReservationSchema = z.object({
  id: UsageReservationIdSchema,
  projectId: ProjectIdSchema.nullable(),
  userId: UserIdSchema,
  workflow: z.string(),
  workflowVersion: z.string(),
  provider: z.string(),
  model: z.string(),
  generationId: z.string().nullable(),
  runId: z.string(),
  estimatedCreditUnits: ProductCreditUnitsSchema.positive(),
  actualCreditUnits: ProductCreditUnitsSchema.nullable(),
  status: z.enum(['RESERVED', 'RECONCILED', 'EXPIRED']),
  outcome: UsageOutcomeSchema.nullable(),
  expiresAt: z.iso.datetime(),
  reconciledAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  replayed: z.boolean()
}).strict();

export const UsageLedgerEntrySchema = z.object({
  id: UsageLedgerEntryIdSchema,
  reservationId: UsageReservationIdSchema,
  eventType: z.enum(['RESERVATION', 'RECONCILIATION', 'EXPIRATION']),
  reservedCreditUnits: ProductCreditUnitsSchema,
  chargedCreditUnits: ProductCreditUnitsSchema,
  releasedCreditUnits: ProductCreditUnitsSchema,
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  toolChargeMicros: z.number().int().nonnegative(),
  providerCostMicros: z.number().int().nonnegative(),
  currency: CurrencySchema,
  outcome: UsageOutcomeSchema.nullable(),
  retryCount: z.number().int().nonnegative(),
  fallbackUsed: z.boolean(),
  cacheHit: z.boolean(),
  projectId: ProjectIdSchema.nullable(),
  userId: UserIdSchema,
  workflow: z.string(),
  workflowVersion: z.string(),
  provider: z.string(),
  model: z.string(),
  generationId: z.string().nullable(),
  runId: z.string(),
  occurredAt: z.iso.datetime()
}).strict();

export const UpdateBudgetPolicyRequestSchema = z.object({
  dailyCreditLimit: ProductCreditUnitsSchema,
  userDailyCreditLimit: ProductCreditUnitsSchema,
  projectDailyCreditLimit: ProductCreditUnitsSchema,
  alertThresholdPercent: z.number().int().min(1).max(100)
}).strict().refine((value) => value.userDailyCreditLimit <= value.dailyCreditLimit, {
  message: 'User daily limit cannot exceed the organization daily limit',
  path: ['userDailyCreditLimit']
}).refine((value) => value.projectDailyCreditLimit <= value.dailyCreditLimit, {
  message: 'Project daily limit cannot exceed the organization daily limit',
  path: ['projectDailyCreditLimit']
});

export const BudgetPolicySchema = z.object({
  id: BudgetPolicyIdSchema,
  dailyCreditLimit: ProductCreditUnitsSchema,
  userDailyCreditLimit: ProductCreditUnitsSchema,
  projectDailyCreditLimit: ProductCreditUnitsSchema,
  alertThresholdPercent: z.number().int().min(1).max(100),
  rowVersion: z.number().int().positive(),
  updatedAt: z.iso.datetime(),
  replayed: z.boolean()
}).strict();

export const ExpiredReservationRecoverySchema = z.object({
  releasedReservations: z.number().int().nonnegative(),
  releasedCreditUnits: ProductCreditUnitsSchema
}).strict();

export const BillingOverviewSchema = z.object({
  plan: z.object({
    id: PlanIdSchema,
    code: z.string().min(1),
    name: z.string().min(1),
    currency: CurrencySchema
  }).strict(),
  subscription: z.object({
    id: SubscriptionIdSchema,
    status: z.enum(['TRIALING', 'ACTIVE', 'PAST_DUE']),
    billingPeriodStart: z.iso.datetime(),
    billingPeriodEnd: z.iso.datetime()
  }).strict(),
  entitlements: z.object({
    aiUsageEnabled: z.boolean(),
    maxCreditsPerRequest: ProductCreditUnitsSchema,
    maxDailyCredits: ProductCreditUnitsSchema,
    maxUserDailyCredits: ProductCreditUnitsSchema,
    maxProjectDailyCredits: ProductCreditUnitsSchema
  }).strict(),
  policy: BudgetPolicySchema.omit({ replayed: true }),
  balance: z.object({
    id: CreditBalanceIdSchema,
    allocatedCreditUnits: ProductCreditUnitsSchema,
    reservedCreditUnits: ProductCreditUnitsSchema,
    consumedCreditUnits: ProductCreditUnitsSchema,
    remainingCreditUnits: ProductCreditUnitsSchema,
    committedPercent: z.number().min(0).max(100),
    alertThresholdPercent: z.number().int().min(1).max(100),
    status: z.enum(['AVAILABLE', 'APPROACHING', 'EXHAUSTED']),
    rowVersion: z.number().int().positive()
  }).strict(),
  dailyUsage: z.object({
    committedCreditUnits: ProductCreditUnitsSchema,
    remainingCreditUnits: ProductCreditUnitsSchema
  }).strict(),
  expiredReservations: z.object({
    count: z.number().int().nonnegative(),
    reservedCreditUnits: ProductCreditUnitsSchema
  }).strict(),
  recentUsage: z.array(UsageLedgerEntrySchema).max(25)
}).strict();

export type ReserveUsageRequest = z.infer<typeof ReserveUsageRequestSchema>;
export type ReconcileUsageRequest = z.infer<typeof ReconcileUsageRequestSchema>;
export type UsageReservation = z.infer<typeof UsageReservationSchema>;
export type BillingOverview = z.infer<typeof BillingOverviewSchema>;
export type UpdateBudgetPolicyRequest = z.infer<typeof UpdateBudgetPolicyRequestSchema>;
export type BudgetPolicy = z.infer<typeof BudgetPolicySchema>;
export type ExpiredReservationRecovery = z.infer<typeof ExpiredReservationRecoverySchema>;
