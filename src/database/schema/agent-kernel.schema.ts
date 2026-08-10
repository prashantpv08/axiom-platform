import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex
} from 'drizzle-orm/pg-core';
import { organizations } from './foundation.schema';
import { users } from './identity.schema';
import { modelDefinitions, modelPolicies } from './model-catalog.schema';
import type { ModelTier } from '../../agent-kernel/agent-kernel.schema';
import type { GenerationUsage, ModelProviderCode } from '../../agent-kernel/generation.schema';

export const promptVersions = pgTable('prompt_versions', {
  id: text('id').primaryKey(),
  prompt: text('prompt').notNull(),
  version: text('version').notNull(),
  template: text('template').notNull(),
  templateSha256: text('template_sha256').notNull(),
  status: text('status').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('prompt_versions_prompt_version_uidx').on(table.prompt, table.version),
  check('prompt_versions_hash_check', sql`${table.templateSha256} ~ '^[a-f0-9]{64}$'`),
  check('prompt_versions_status_check', sql`${table.status} in ('ACTIVE', 'RETIRED')`)
]);

export const agentWorkflowVersions = pgTable('agent_workflow_versions', {
  id: text('id').primaryKey(),
  workflow: text('workflow').notNull(),
  version: text('version').notNull(),
  promptVersion: text('prompt_version').notNull(),
  schemaVersion: text('schema_version').notNull(),
  evaluatorVersion: text('evaluator_version').notNull(),
  maximumAttempts: integer('maximum_attempts').notNull(),
  allowedTools: text('allowed_tools').array().notNull(),
  status: text('status').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('agent_workflow_versions_workflow_version_uidx').on(table.workflow, table.version),
  check('agent_workflow_versions_attempts_check', sql`${table.maximumAttempts} between 1 and 3`),
  check('agent_workflow_versions_status_check', sql`${table.status} in ('ACTIVE', 'RETIRED')`)
]);

export const agentRuns = pgTable('agent_runs', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
  projectId: text('project_id'),
  generationId: text('generation_id').notNull(),
  workflow: text('workflow').notNull(),
  workflowVersion: text('workflow_version').notNull(),
  promptVersion: text('prompt_version').notNull(),
  policyId: text('policy_id').notNull().references(() => modelPolicies.id, { onDelete: 'restrict' }),
  policyVersion: integer('policy_version').notNull(),
  tier: text('tier').$type<ModelTier>().notNull(),
  modelDefinitionId: text('model_definition_id').notNull().references(() => modelDefinitions.id, { onDelete: 'restrict' }),
  status: text('status').notNull().default('RUNNING'),
  budgetStatus: text('budget_status').notNull(),
  budgetReason: text('budget_reason'),
  budgetReservationId: text('budget_reservation_id'),
  contextHash: text('context_hash').notNull(),
  outputHash: text('output_hash'),
  finalModelCallId: text('final_model_call_id'),
  errorCode: text('error_code'),
  requestId: text('request_id').notNull(),
  actorUserId: text('actor_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true, mode: 'string' })
}, (table) => [
  uniqueIndex('agent_runs_organization_id_uidx').on(table.organizationId, table.id),
  index('agent_runs_project_started_idx').on(table.organizationId, table.projectId, table.startedAt, table.id),
  index('agent_runs_generation_idx').on(table.organizationId, table.generationId),
  check('agent_runs_policy_version_check', sql`${table.policyVersion} > 0`),
  check('agent_runs_tier_check', sql`${table.tier} in ('ECONOMY', 'BALANCED', 'BEST')`),
  check('agent_runs_status_check', sql`${table.status} in ('RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')`),
  check('agent_runs_context_hash_check', sql`${table.contextHash} ~ '^[a-f0-9]{64}$'`),
  check('agent_runs_output_hash_check', sql`${table.outputHash} is null or ${table.outputHash} ~ '^[a-f0-9]{64}$'`),
  check('agent_runs_budget_check', sql`(${table.budgetStatus} = 'NOT_APPLICABLE' and ${table.budgetReason} = 'NON_BILLABLE_LOCAL_FIXTURE' and ${table.budgetReservationId} is null) or (${table.budgetStatus} = 'RESERVED' and ${table.budgetReason} is null and ${table.budgetReservationId} is not null)`),
  check('agent_runs_terminal_check', sql`(${table.status} = 'RUNNING' and ${table.completedAt} is null and ${table.outputHash} is null and ${table.errorCode} is null) or (${table.status} = 'SUCCEEDED' and ${table.completedAt} is not null and ${table.outputHash} is not null and ${table.finalModelCallId} is not null and ${table.errorCode} is null) or (${table.status} in ('FAILED', 'CANCELLED') and ${table.completedAt} is not null and ${table.outputHash} is null and ${table.errorCode} is not null)`)
]);

export const modelCalls = pgTable('model_calls', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  runId: text('run_id').notNull(),
  attempt: integer('attempt').notNull(),
  provider: text('provider').$type<ModelProviderCode>().notNull(),
  modelDefinitionId: text('model_definition_id').notNull().references(() => modelDefinitions.id, { onDelete: 'restrict' }),
  immutableModelId: text('immutable_model_id').notNull(),
  status: text('status').notNull(),
  requestHash: text('request_hash').notNull(),
  responseHash: text('response_hash'),
  providerRequestId: text('provider_request_id'),
  finishReason: text('finish_reason'),
  usage: jsonb('usage').$type<GenerationUsage>(),
  latencyMs: integer('latency_ms').notNull(),
  errorCode: text('error_code'),
  retryable: boolean('retryable').notNull().default(false),
  occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'string' }).notNull()
}, (table) => [
  uniqueIndex('model_calls_run_attempt_uidx').on(table.organizationId, table.runId, table.attempt),
  index('model_calls_organization_occurred_idx').on(table.organizationId, table.occurredAt, table.id),
  foreignKey({ name: 'model_calls_run_scope_fk', columns: [table.organizationId, table.runId], foreignColumns: [agentRuns.organizationId, agentRuns.id] }).onDelete('restrict'),
  check('model_calls_attempt_check', sql`${table.attempt} between 1 and 3`),
  check('model_calls_provider_check', sql`${table.provider} in ('LOCAL_FIXTURE', 'OPENAI', 'GROQ')`),
  check('model_calls_status_check', sql`${table.status} in ('SUCCEEDED', 'FAILED')`),
  check('model_calls_request_hash_check', sql`${table.requestHash} ~ '^[a-f0-9]{64}$'`),
  check('model_calls_response_hash_check', sql`${table.responseHash} is null or ${table.responseHash} ~ '^[a-f0-9]{64}$'`),
  check('model_calls_latency_check', sql`${table.latencyMs} >= 0`),
  check('model_calls_result_check', sql`(${table.status} = 'SUCCEEDED' and ${table.responseHash} is not null and ${table.finishReason} is not null and ${table.usage} is not null and ${table.errorCode} is null) or (${table.status} = 'FAILED' and ${table.responseHash} is null and ${table.finishReason} is null and ${table.usage} is null and ${table.errorCode} is not null)`)
]);
