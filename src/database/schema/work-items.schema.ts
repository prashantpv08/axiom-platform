import { sql } from 'drizzle-orm';
import {
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
import { users } from './identity.schema';
import { projects, projectGraphs } from './projects.schema';
import { timestamps } from './timestamps';
import type { TicketQualityReport } from '../../work-items/ticket-quality.schema';
import type { WorkItem } from '../../work-items/work-item.schema';

export const workItemGenerations = pgTable('work_item_generations', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  projectId: text('project_id').notNull(),
  sourceGraphVersion: integer('source_graph_version').notNull(),
  status: text('status').notNull().default('DRAFT'),
  contentHash: text('content_hash').notNull(),
  schemaVersion: text('schema_version').notNull(),
  evaluatorVersion: text('evaluator_version').notNull(),
  promptVersion: text('prompt_version').notNull(),
  workflowVersion: text('workflow_version').notNull(),
  agentRunId: text('agent_run_id'),
  qualityReport: jsonb('quality_report').$type<TicketQualityReport>().notNull(),
  createdByUserId: text('created_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('work_item_generations_scope_id_uidx').on(table.organizationId, table.projectId, table.id),
  index('work_item_generations_project_created_idx').on(table.organizationId, table.projectId, table.createdAt, table.id),
  check('work_item_generations_status_check', sql`${table.status} in ('DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'SUPERSEDED')`),
  check('work_item_generations_hash_check', sql`${table.contentHash} ~ '^[a-f0-9]{64}$'`),
  foreignKey({ name: 'work_item_generations_project_fk', columns: [table.organizationId, table.projectId], foreignColumns: [projects.organizationId, projects.id] }).onDelete('cascade'),
  foreignKey({ name: 'work_item_generations_graph_fk', columns: [table.organizationId, table.projectId, table.sourceGraphVersion], foreignColumns: [projectGraphs.organizationId, projectGraphs.projectId, projectGraphs.graphVersion] }).onDelete('restrict')
]);

export const workItems = pgTable('work_items', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  projectId: text('project_id').notNull(),
  type: text('type').notNull(),
  parentId: text('parent_id'),
  currentVersion: integer('current_version').notNull(),
  reviewStatus: text('review_status').notNull().default('DRAFT'),
  sourceGraphVersion: integer('source_graph_version').notNull(),
  rowVersion: integer('row_version').notNull().default(1),
  ...timestamps
}, (table) => [
  index('work_items_project_updated_idx').on(table.organizationId, table.projectId, table.updatedAt, table.id),
  check('work_items_type_check', sql`${table.type} in ('INITIATIVE', 'EPIC', 'STORY', 'TASK', 'DEFECT')`),
  check('work_items_review_status_check', sql`${table.reviewStatus} in ('DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'SUPERSEDED')`),
  check('work_items_version_check', sql`${table.currentVersion} > 0 and ${table.rowVersion} > 0 and ${table.sourceGraphVersion} > 0`),
  foreignKey({ name: 'work_items_project_fk', columns: [table.organizationId, table.projectId], foreignColumns: [projects.organizationId, projects.id] }).onDelete('cascade'),
  foreignKey({ name: 'work_items_parent_fk', columns: [table.parentId], foreignColumns: [table.id] }).onDelete('restrict')
]);

export const workItemVersions = pgTable('work_item_versions', {
  organizationId: text('organization_id').notNull(),
  projectId: text('project_id').notNull(),
  workItemId: text('work_item_id').notNull().references(() => workItems.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  generationId: text('generation_id').notNull(),
  payload: jsonb('payload').$type<WorkItem>().notNull(),
  contentHash: text('content_hash').notNull(),
  createdByUserId: text('created_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow()
}, (table) => [
  primaryKey({ name: 'work_item_versions_pk', columns: [table.workItemId, table.version] }),
  index('work_item_versions_generation_idx').on(table.generationId),
  check('work_item_versions_version_check', sql`${table.version} > 0`),
  check('work_item_versions_hash_check', sql`${table.contentHash} ~ '^[a-f0-9]{64}$'`)
]);

export const workItemGenerationItems = pgTable('work_item_generation_items', {
  generationId: text('generation_id').notNull().references(() => workItemGenerations.id, { onDelete: 'cascade' }),
  workItemId: text('work_item_id').notNull(),
  workItemVersion: integer('work_item_version').notNull(),
  position: integer('position').notNull()
}, (table) => [
  primaryKey({ name: 'work_item_generation_items_pk', columns: [table.generationId, table.workItemId] }),
  uniqueIndex('work_item_generation_items_position_uidx').on(table.generationId, table.position),
  foreignKey({ name: 'work_item_generation_items_version_fk', columns: [table.workItemId, table.workItemVersion], foreignColumns: [workItemVersions.workItemId, workItemVersions.version] }).onDelete('restrict'),
  check('work_item_generation_items_position_check', sql`${table.position} >= 0 and ${table.workItemVersion} > 0`)
]);

export const workItemReviews = pgTable('work_item_reviews', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  projectId: text('project_id').notNull(),
  generationId: text('generation_id').notNull().references(() => workItemGenerations.id, { onDelete: 'restrict' }),
  decision: text('decision').notNull(),
  reasonCategory: text('reason_category').notNull(),
  comment: text('comment').notNull(),
  generationContentHash: text('generation_content_hash').notNull(),
  reviewedContentHash: text('reviewed_content_hash').notNull(),
  qualityReport: jsonb('quality_report').$type<TicketQualityReport>().notNull(),
  reviewedByUserId: text('reviewed_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('work_item_reviews_generation_uidx').on(table.generationId),
  index('work_item_reviews_project_reviewed_idx').on(table.organizationId, table.projectId, table.reviewedAt, table.id),
  check('work_item_reviews_decision_check', sql`${table.decision} in ('ACCEPT', 'ACCEPT_WITH_EDITS', 'REJECT')`),
  check('work_item_reviews_comment_check', sql`char_length(${table.comment}) between 10 and 2000`),
  check('work_item_reviews_generation_hash_check', sql`${table.generationContentHash} ~ '^[a-f0-9]{64}$'`),
  check('work_item_reviews_reviewed_hash_check', sql`${table.reviewedContentHash} ~ '^[a-f0-9]{64}$'`),
  foreignKey({ name: 'work_item_reviews_project_fk', columns: [table.organizationId, table.projectId], foreignColumns: [projects.organizationId, projects.id] }).onDelete('cascade'),
  foreignKey({ name: 'work_item_reviews_generation_scope_fk', columns: [table.organizationId, table.projectId, table.generationId], foreignColumns: [workItemGenerations.organizationId, workItemGenerations.projectId, workItemGenerations.id] }).onDelete('restrict')
]);

export const workItemReviewItems = pgTable('work_item_review_items', {
  reviewId: text('review_id').notNull().references(() => workItemReviews.id, { onDelete: 'cascade' }),
  workItemId: text('work_item_id').notNull(),
  workItemVersion: integer('work_item_version').notNull(),
  position: integer('position').notNull()
}, (table) => [
  primaryKey({ name: 'work_item_review_items_pk', columns: [table.reviewId, table.workItemId] }),
  uniqueIndex('work_item_review_items_position_uidx').on(table.reviewId, table.position),
  foreignKey({ name: 'work_item_review_items_version_fk', columns: [table.workItemId, table.workItemVersion], foreignColumns: [workItemVersions.workItemId, workItemVersions.version] }).onDelete('restrict'),
  check('work_item_review_items_position_check', sql`${table.position} >= 0 and ${table.workItemVersion} > 0`)
]);

