import { sql } from 'drizzle-orm';
import {
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
import { agentRuns } from './agent-kernel.schema';
import { users } from './identity.schema';
import { projects, projectGraphs } from './projects.schema';
import type { EngineeringPlan, EngineeringPlanQualityReport } from '../../engineering-plans/engineering-plan.schema';

export const engineeringPlanGenerations = pgTable('engineering_plan_generations', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  projectId: text('project_id').notNull(),
  sourceGraphVersion: integer('source_graph_version').notNull(),
  version: integer('version').notNull(),
  status: text('status').notNull().default('DRAFT'),
  contentHash: text('content_hash').notNull(),
  schemaVersion: text('schema_version').notNull(),
  evaluatorVersion: text('evaluator_version').notNull(),
  promptVersion: text('prompt_version').notNull(),
  workflowVersion: text('workflow_version').notNull(),
  referenceCatalogVersion: text('reference_catalog_version').notNull(),
  artifactApprovalId: text('artifact_approval_id').notNull(),
  architectureDecisionId: text('architecture_decision_id').notNull(),
  architectureOptionId: text('architecture_option_id').notNull(),
  agentRunId: text('agent_run_id').notNull(),
  plan: jsonb('plan').$type<EngineeringPlan>().notNull(),
  qualityReport: jsonb('quality_report').$type<EngineeringPlanQualityReport>().notNull(),
  createdByUserId: text('created_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  requestId: text('request_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('engineering_plan_generations_project_version_uidx').on(table.organizationId, table.projectId, table.version),
  uniqueIndex('engineering_plan_generations_scope_id_uidx').on(table.organizationId, table.projectId, table.id),
  index('engineering_plan_generations_project_created_idx').on(table.organizationId, table.projectId, table.createdAt, table.id),
  check('engineering_plan_generations_version_check', sql`${table.version} > 0 and ${table.sourceGraphVersion} > 0`),
  check('engineering_plan_generations_status_check', sql`${table.status} = 'DRAFT'`),
  check('engineering_plan_generations_hash_check', sql`${table.contentHash} ~ '^[a-f0-9]{64}$'`),
  foreignKey({ name: 'engineering_plan_generations_project_fk', columns: [table.organizationId, table.projectId], foreignColumns: [projects.organizationId, projects.id] }).onDelete('cascade'),
  foreignKey({ name: 'engineering_plan_generations_graph_fk', columns: [table.organizationId, table.projectId, table.sourceGraphVersion], foreignColumns: [projectGraphs.organizationId, projectGraphs.projectId, projectGraphs.graphVersion] }).onDelete('restrict'),
  foreignKey({ name: 'engineering_plan_generations_agent_run_fk', columns: [table.organizationId, table.agentRunId], foreignColumns: [agentRuns.organizationId, agentRuns.id] }).onDelete('restrict')
]);
