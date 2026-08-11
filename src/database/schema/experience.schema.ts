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
import { users } from './identity.schema';
import { projectGraphs } from './projects.schema';
import type {
  BusinessContextPreview,
  BusinessContextProposedGraphChange,
  ExperienceApplicabilityDecision
} from '../../experience/business-context.schema';

export const experienceApplicabilityDecisions = pgTable('experience_applicability_decisions', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  projectId: text('project_id').notNull(),
  previousGraphVersion: integer('previous_graph_version').notNull(),
  graphVersion: integer('graph_version').notNull(),
  decision: text('decision').$type<ExperienceApplicabilityDecision['decision']>().notNull(),
  rationale: text('rationale').notNull(),
  sourcePreviewContentHash: text('source_preview_content_hash').notNull(),
  truthStatus: text('truth_status').$type<'HUMAN_CONFIRMED'>().notNull(),
  decidedByUserId: text('decided_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  decidedAt: timestamp('decided_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('experience_applicability_decisions_project_graph_uidx').on(table.organizationId, table.projectId, table.graphVersion),
  uniqueIndex('experience_applicability_decisions_scope_id_uidx').on(table.organizationId, table.projectId, table.id),
  index('experience_applicability_decisions_project_decided_idx').on(table.organizationId, table.projectId, table.decidedAt, table.id),
  check('experience_applicability_decisions_graph_check', sql`${table.previousGraphVersion} > 0 and ${table.graphVersion} = ${table.previousGraphVersion} + 1`),
  check('experience_applicability_decisions_decision_check', sql`${table.decision} in ('APPLICABLE', 'NOT_APPLICABLE')`),
  check('experience_applicability_decisions_truth_check', sql`${table.truthStatus} = 'HUMAN_CONFIRMED'`),
  check('experience_applicability_decisions_hash_check', sql`${table.sourcePreviewContentHash} ~ '^[a-f0-9]{64}$'`),
  foreignKey({ name: 'experience_applicability_decisions_graph_fk', columns: [table.organizationId, table.projectId, table.graphVersion], foreignColumns: [projectGraphs.organizationId, projectGraphs.projectId, projectGraphs.graphVersion] }).onDelete('restrict')
]);

export const businessContextVersions = pgTable('business_context_versions', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  projectId: text('project_id').notNull(),
  graphVersion: integer('graph_version').notNull(),
  version: integer('version').notNull(),
  contentHash: text('content_hash').notNull(),
  compilerVersion: text('compiler_version').notNull(),
  payload: jsonb('payload').$type<BusinessContextPreview>().notNull(),
  generatedByUserId: text('generated_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  generatedAt: timestamp('generated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('business_context_versions_project_version_uidx').on(table.organizationId, table.projectId, table.version),
  uniqueIndex('business_context_versions_scope_id_uidx').on(table.organizationId, table.projectId, table.id),
  index('business_context_versions_project_graph_created_idx').on(table.organizationId, table.projectId, table.graphVersion, table.generatedAt, table.id),
  check('business_context_versions_version_check', sql`${table.version} > 0 and ${table.graphVersion} > 0`),
  check('business_context_versions_hash_check', sql`${table.contentHash} ~ '^[a-f0-9]{64}$'`),
  foreignKey({ name: 'business_context_versions_graph_fk', columns: [table.organizationId, table.projectId, table.graphVersion], foreignColumns: [projectGraphs.organizationId, projectGraphs.projectId, projectGraphs.graphVersion] }).onDelete('restrict')
]);

export const businessContextReviews = pgTable('business_context_reviews', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  projectId: text('project_id').notNull(),
  graphVersion: integer('graph_version').notNull(),
  contextVersionId: text('context_version_id').notNull(),
  contextContentHash: text('context_content_hash').notNull(),
  decision: text('decision').notNull(),
  feedbackCategory: text('feedback_category').notNull(),
  comment: text('comment').notNull(),
  proposedGraphChanges: jsonb('proposed_graph_changes').$type<BusinessContextProposedGraphChange[]>().notNull().default([]),
  truthStatus: text('truth_status').notNull(),
  reviewedByUserId: text('reviewed_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('business_context_reviews_context_uidx').on(table.organizationId, table.projectId, table.contextVersionId),
  uniqueIndex('business_context_reviews_scope_id_uidx').on(table.organizationId, table.projectId, table.id),
  index('business_context_reviews_project_graph_reviewed_idx').on(table.organizationId, table.projectId, table.graphVersion, table.reviewedAt, table.id),
  check('business_context_reviews_hash_check', sql`${table.contextContentHash} ~ '^[a-f0-9]{64}$'`),
  check('business_context_reviews_decision_check', sql`${table.decision} in ('ACCEPT', 'ACCEPT_WITH_EDITS', 'REJECT')`),
  check('business_context_reviews_truth_check', sql`${table.truthStatus} in ('HUMAN_APPROVED', 'HUMAN_REVIEWED')`),
  foreignKey({ name: 'business_context_reviews_graph_fk', columns: [table.organizationId, table.projectId, table.graphVersion], foreignColumns: [projectGraphs.organizationId, projectGraphs.projectId, projectGraphs.graphVersion] }).onDelete('restrict'),
  foreignKey({ name: 'business_context_reviews_version_fk', columns: [table.organizationId, table.projectId, table.contextVersionId], foreignColumns: [businessContextVersions.organizationId, businessContextVersions.projectId, businessContextVersions.id] }).onDelete('restrict')
]);
