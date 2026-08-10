import { sql } from 'drizzle-orm';
import {
  check,
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
import { timestamps } from './timestamps';
import type {
  ModelDataPolicyStatusSchema,
  ModelEvaluationStatusSchema,
  ModelExecutionStatusSchema,
  ModelProviderLifecycleSchema
} from '../../model-catalog/model-catalog.schema';

export const modelProviders = pgTable('model_providers', {
  id: text('id').primaryKey(),
  code: text('code').notNull(),
  displayName: text('display_name').notNull(),
  lifecycleStatus: text('lifecycle_status').$type<typeof ModelProviderLifecycleSchema._output>().notNull(),
  executionStatus: text('execution_status').$type<typeof ModelExecutionStatusSchema._output>().notNull(),
  dataPolicyStatus: text('data_policy_status').$type<typeof ModelDataPolicyStatusSchema._output>().notNull(),
  allowedRegions: text('allowed_regions').array().notNull(),
  ...timestamps
}, (table) => [
  uniqueIndex('model_providers_code_uidx').on(table.code),
  check('model_providers_code_check', sql`${table.code} in ('LOCAL_FIXTURE', 'OPENAI', 'GROQ')`),
  check('model_providers_lifecycle_check', sql`${table.lifecycleStatus} in ('LOCAL_ONLY', 'CANDIDATE', 'QUALIFIED', 'SUSPENDED', 'RETIRED')`),
  check('model_providers_execution_check', sql`${table.executionStatus} in ('ENABLED', 'DISABLED')`),
  check('model_providers_data_policy_check', sql`${table.dataPolicyStatus} in ('NO_EXTERNAL_TRANSFER', 'REQUIRES_REVIEW', 'APPROVED')`),
  check('model_providers_enabled_lifecycle_check', sql`${table.executionStatus} = 'DISABLED' or ${table.lifecycleStatus} in ('LOCAL_ONLY', 'QUALIFIED')`)
]);

export const modelDefinitions = pgTable('model_definitions', {
  id: text('id').primaryKey(),
  providerId: text('provider_id').notNull().references(() => modelProviders.id, { onDelete: 'restrict' }),
  immutableModelId: text('immutable_model_id').notNull(),
  displayName: text('display_name').notNull(),
  lifecycleStatus: text('lifecycle_status').$type<typeof ModelProviderLifecycleSchema._output>().notNull(),
  executionStatus: text('execution_status').$type<typeof ModelExecutionStatusSchema._output>().notNull(),
  capabilities: jsonb('capabilities').$type<{ structuredOutput: boolean; tools: boolean; vision: boolean }>().notNull(),
  contextWindowTokens: integer('context_window_tokens'),
  maxOutputTokens: integer('max_output_tokens'),
  pricing: jsonb('pricing').$type<Record<string, unknown>>().notNull(),
  dataPolicyStatus: text('data_policy_status').$type<typeof ModelDataPolicyStatusSchema._output>().notNull(),
  allowedRegions: text('allowed_regions').array().notNull(),
  evaluationStatus: text('evaluation_status').$type<typeof ModelEvaluationStatusSchema._output>().notNull(),
  evaluationScores: jsonb('evaluation_scores').$type<Record<string, number>>().notNull().default({}),
  evaluationRunId: text('evaluation_run_id'),
  evaluatedAt: timestamp('evaluated_at', { withTimezone: true, mode: 'string' }),
  ...timestamps
}, (table) => [
  uniqueIndex('model_definitions_provider_model_uidx').on(table.providerId, table.immutableModelId),
  index('model_definitions_provider_lifecycle_idx').on(table.providerId, table.lifecycleStatus, table.id),
  check('model_definitions_lifecycle_check', sql`${table.lifecycleStatus} in ('LOCAL_ONLY', 'CANDIDATE', 'QUALIFIED', 'SUSPENDED', 'RETIRED')`),
  check('model_definitions_execution_check', sql`${table.executionStatus} in ('ENABLED', 'DISABLED')`),
  check('model_definitions_enabled_lifecycle_check', sql`${table.executionStatus} = 'DISABLED' or ${table.lifecycleStatus} in ('LOCAL_ONLY', 'QUALIFIED')`),
  check('model_definitions_context_check', sql`${table.contextWindowTokens} is null or ${table.contextWindowTokens} > 0`),
  check('model_definitions_output_check', sql`${table.maxOutputTokens} is null or ${table.maxOutputTokens} > 0`),
  check('model_definitions_pricing_check', sql`${table.pricing}->>'status' in ('NOT_APPLICABLE', 'UNVERIFIED', 'VERIFIED')`),
  check('model_definitions_data_policy_check', sql`${table.dataPolicyStatus} in ('NO_EXTERNAL_TRANSFER', 'REQUIRES_REVIEW', 'APPROVED')`),
  check('model_definitions_evaluation_check', sql`${table.evaluationStatus} in ('LOCAL_FIXTURE_ONLY', 'NOT_EVALUATED', 'QUALIFIED', 'FAILED')`)
]);

export const modelPolicies = pgTable('model_policies', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organizations.id, { onDelete: 'restrict' }),
  economyModelDefinitionId: text('economy_model_definition_id').notNull().references(() => modelDefinitions.id, { onDelete: 'restrict' }),
  balancedModelDefinitionId: text('balanced_model_definition_id').notNull().references(() => modelDefinitions.id, { onDelete: 'restrict' }),
  bestModelDefinitionId: text('best_model_definition_id').notNull().references(() => modelDefinitions.id, { onDelete: 'restrict' }),
  updatedByUserId: text('updated_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
  rowVersion: integer('row_version').notNull().default(1),
  ...timestamps
}, (table) => [
  uniqueIndex('model_policies_organization_uidx').on(table.organizationId),
  check('model_policies_row_version_check', sql`${table.rowVersion} > 0`)
]);
