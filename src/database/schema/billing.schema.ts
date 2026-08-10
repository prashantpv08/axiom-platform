import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex
} from 'drizzle-orm/pg-core';
import { organizations } from './foundation.schema';
import { users } from './identity.schema';
import { timestamps } from './timestamps';

export const plans = pgTable('plans', {
  id: text('id').primaryKey(),
  code: text('code').notNull(),
  name: text('name').notNull(),
  status: text('status').notNull().default('ACTIVE'),
  currency: text('currency').notNull(),
  billingPeriodCreditUnits: integer('billing_period_credit_units').notNull(),
  ...timestamps
}, (table) => [
  uniqueIndex('plans_code_uidx').on(table.code),
  check('plans_status_check', sql`${table.status} in ('ACTIVE', 'RETIRED')`),
  check('plans_currency_check', sql`${table.currency} ~ '^[A-Z]{3}$'`),
  check('plans_credit_units_check', sql`${table.billingPeriodCreditUnits} >= 0`)
]);

export const planEntitlements = pgTable('plan_entitlements', {
  planId: text('plan_id').notNull().references(() => plans.id, { onDelete: 'restrict' }),
  key: text('key').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  integerLimit: integer('integer_limit'),
  ...timestamps
}, (table) => [
  primaryKey({ name: 'plan_entitlements_pk', columns: [table.planId, table.key] }),
  check('plan_entitlements_key_check', sql`${table.key} in ('AI_USAGE', 'MAX_CREDITS_PER_REQUEST', 'MAX_DAILY_CREDITS', 'MAX_USER_DAILY_CREDITS', 'MAX_PROJECT_DAILY_CREDITS')`),
  check('plan_entitlements_integer_limit_check', sql`${table.integerLimit} is null or ${table.integerLimit} >= 0`)
]);

export const subscriptions = pgTable('subscriptions', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
  planId: text('plan_id').notNull().references(() => plans.id, { onDelete: 'restrict' }),
  status: text('status').notNull(),
  billingPeriodStart: timestamp('billing_period_start', { withTimezone: true, mode: 'string' }).notNull(),
  billingPeriodEnd: timestamp('billing_period_end', { withTimezone: true, mode: 'string' }).notNull(),
  provider: text('provider'),
  externalCustomerId: text('external_customer_id'),
  externalSubscriptionId: text('external_subscription_id'),
  providerUpdatedAt: timestamp('provider_updated_at', { withTimezone: true, mode: 'string' }),
  providerEventId: text('provider_event_id'),
  rowVersion: integer('row_version').notNull().default(1),
  ...timestamps
}, (table) => [
  uniqueIndex('subscriptions_organization_id_uidx').on(table.organizationId, table.id),
  uniqueIndex('subscriptions_provider_external_uidx').on(table.provider, table.externalSubscriptionId)
    .where(sql`${table.provider} is not null and ${table.externalSubscriptionId} is not null`),
  check('subscriptions_status_check', sql`${table.status} in ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED')`),
  check('subscriptions_period_check', sql`${table.billingPeriodEnd} > ${table.billingPeriodStart}`),
  check('subscriptions_row_version_check', sql`${table.rowVersion} > 0`)
]);

export const subscriptionWebhookEvents = pgTable('subscription_webhook_events', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
  provider: text('provider').notNull(),
  externalEventId: text('external_event_id').notNull(),
  eventType: text('event_type').notNull(),
  payloadHash: text('payload_hash').notNull(),
  normalizedPayload: jsonb('normalized_payload').$type<Record<string, unknown>>().notNull(),
  signatureTimestamp: timestamp('signature_timestamp', { withTimezone: true, mode: 'string' }).notNull(),
  status: text('status').notNull().default('RECEIVED'),
  attemptCount: integer('attempt_count').notNull().default(0),
  lastErrorCode: text('last_error_code'),
  responsePayload: jsonb('response_payload').$type<Record<string, unknown>>(),
  processedAt: timestamp('processed_at', { withTimezone: true, mode: 'string' }),
  ...timestamps
}, (table) => [
  uniqueIndex('subscription_webhook_events_provider_event_uidx').on(table.provider, table.externalEventId),
  index('subscription_webhook_events_organization_created_idx').on(table.organizationId, table.createdAt, table.id),
  check('subscription_webhook_events_hash_check', sql`${table.payloadHash} ~ '^[a-f0-9]{64}$'`),
  check('subscription_webhook_events_status_check', sql`${table.status} in ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED')`),
  check('subscription_webhook_events_attempt_check', sql`${table.attemptCount} >= 0`),
  check('subscription_webhook_events_state_check', sql`(${table.status} = 'RECEIVED' and ${table.processedAt} is null and ${table.lastErrorCode} is null and ${table.responsePayload} is null) or (${table.status} in ('PROCESSED', 'IGNORED') and ${table.processedAt} is not null and ${table.lastErrorCode} is null and ${table.responsePayload} is not null) or (${table.status} = 'FAILED' and ${table.processedAt} is not null and ${table.lastErrorCode} is not null and ${table.responsePayload} is null)`)
]);

export const creditBalances = pgTable('credit_balances', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  subscriptionId: text('subscription_id').notNull(),
  periodStart: timestamp('period_start', { withTimezone: true, mode: 'string' }).notNull(),
  periodEnd: timestamp('period_end', { withTimezone: true, mode: 'string' }).notNull(),
  allocatedCreditUnits: integer('allocated_credit_units').notNull(),
  reservedCreditUnits: integer('reserved_credit_units').notNull().default(0),
  consumedCreditUnits: integer('consumed_credit_units').notNull().default(0),
  alertThresholdPercent: integer('alert_threshold_percent').notNull().default(80),
  rowVersion: integer('row_version').notNull().default(1),
  ...timestamps
}, (table) => [
  uniqueIndex('credit_balances_organization_id_uidx').on(table.organizationId, table.id),
  uniqueIndex('credit_balances_subscription_period_uidx').on(table.subscriptionId, table.periodStart, table.periodEnd),
  foreignKey({ name: 'credit_balances_subscription_scope_fk', columns: [table.organizationId, table.subscriptionId], foreignColumns: [subscriptions.organizationId, subscriptions.id] }).onDelete('restrict'),
  check('credit_balances_period_check', sql`${table.periodEnd} > ${table.periodStart}`),
  check('credit_balances_units_check', sql`${table.allocatedCreditUnits} >= 0 and ${table.reservedCreditUnits} >= 0 and ${table.consumedCreditUnits} >= 0 and ${table.reservedCreditUnits} + ${table.consumedCreditUnits} <= ${table.allocatedCreditUnits}`),
  check('credit_balances_alert_check', sql`${table.alertThresholdPercent} between 1 and 100`),
  check('credit_balances_row_version_check', sql`${table.rowVersion} > 0`)
]);

export const budgetPolicies = pgTable('budget_policies', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
  dailyCreditLimit: integer('daily_credit_limit').notNull(),
  userDailyCreditLimit: integer('user_daily_credit_limit').notNull(),
  projectDailyCreditLimit: integer('project_daily_credit_limit').notNull(),
  alertThresholdPercent: integer('alert_threshold_percent').notNull().default(80),
  rowVersion: integer('row_version').notNull().default(1),
  ...timestamps
}, (table) => [
  uniqueIndex('budget_policies_organization_uidx').on(table.organizationId),
  check('budget_policies_limits_check', sql`${table.dailyCreditLimit} >= 0 and ${table.userDailyCreditLimit} >= 0 and ${table.projectDailyCreditLimit} >= 0 and ${table.userDailyCreditLimit} <= ${table.dailyCreditLimit} and ${table.projectDailyCreditLimit} <= ${table.dailyCreditLimit}`),
  check('budget_policies_alert_check', sql`${table.alertThresholdPercent} between 1 and 100`),
  check('budget_policies_row_version_check', sql`${table.rowVersion} > 0`)
]);

export const usageReservations = pgTable('usage_reservations', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  creditBalanceId: text('credit_balance_id').notNull(),
  projectId: text('project_id'),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  workflow: text('workflow').notNull(),
  workflowVersion: text('workflow_version').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  generationId: text('generation_id'),
  runId: text('run_id').notNull(),
  entitlementKey: text('entitlement_key').notNull(),
  idempotencyKey: text('idempotency_key').notNull(),
  requestHash: text('request_hash').notNull(),
  reconciliationHash: text('reconciliation_hash'),
  estimatedCreditUnits: integer('estimated_credit_units').notNull(),
  actualCreditUnits: integer('actual_credit_units'),
  status: text('status').notNull().default('RESERVED'),
  outcome: text('outcome'),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
  reconciledAt: timestamp('reconciled_at', { withTimezone: true, mode: 'string' }),
  ...timestamps
}, (table) => [
  uniqueIndex('usage_reservations_organization_id_uidx').on(table.organizationId, table.id),
  uniqueIndex('usage_reservations_idempotency_uidx').on(table.organizationId, table.idempotencyKey),
  index('usage_reservations_balance_status_idx').on(table.creditBalanceId, table.status, table.expiresAt),
  foreignKey({ name: 'usage_reservations_balance_scope_fk', columns: [table.organizationId, table.creditBalanceId], foreignColumns: [creditBalances.organizationId, creditBalances.id] }).onDelete('restrict'),
  check('usage_reservations_hash_check', sql`${table.requestHash} ~ '^[a-f0-9]{64}$'`),
  check('usage_reservations_reconciliation_hash_check', sql`${table.reconciliationHash} is null or ${table.reconciliationHash} ~ '^[a-f0-9]{64}$'`),
  check('usage_reservations_estimate_check', sql`${table.estimatedCreditUnits} > 0`),
  check('usage_reservations_actual_check', sql`${table.actualCreditUnits} is null or (${table.actualCreditUnits} >= 0 and ${table.actualCreditUnits} <= ${table.estimatedCreditUnits})`),
  check('usage_reservations_status_check', sql`${table.status} in ('RESERVED', 'RECONCILED', 'EXPIRED')`)
]);

export const usageLedgerEntries = pgTable('usage_ledger_entries', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  creditBalanceId: text('credit_balance_id').notNull(),
  reservationId: text('reservation_id').notNull(),
  eventType: text('event_type').notNull(),
  reservedCreditUnits: integer('reserved_credit_units').notNull().default(0),
  chargedCreditUnits: integer('charged_credit_units').notNull().default(0),
  releasedCreditUnits: integer('released_credit_units').notNull().default(0),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  toolChargeMicros: integer('tool_charge_micros').notNull().default(0),
  providerCostMicros: integer('provider_cost_micros').notNull().default(0),
  currency: text('currency').notNull(),
  outcome: text('outcome'),
  retryCount: integer('retry_count').notNull().default(0),
  fallbackUsed: boolean('fallback_used').notNull().default(false),
  cacheHit: boolean('cache_hit').notNull().default(false),
  projectId: text('project_id'),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  workflow: text('workflow').notNull(),
  workflowVersion: text('workflow_version').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  generationId: text('generation_id'),
  runId: text('run_id').notNull(),
  requestId: text('request_id').notNull(),
  occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow()
}, (table) => [
  index('usage_ledger_organization_occurred_idx').on(table.organizationId, table.occurredAt, table.id),
  index('usage_ledger_project_occurred_idx').on(table.organizationId, table.projectId, table.occurredAt),
  foreignKey({ name: 'usage_ledger_balance_scope_fk', columns: [table.organizationId, table.creditBalanceId], foreignColumns: [creditBalances.organizationId, creditBalances.id] }).onDelete('restrict'),
  foreignKey({ name: 'usage_ledger_reservation_scope_fk', columns: [table.organizationId, table.reservationId], foreignColumns: [usageReservations.organizationId, usageReservations.id] }).onDelete('restrict')
]);

