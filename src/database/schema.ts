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

import type { OrganizationRole } from '../identity/identity.schema';
import type {
  ModelDataPolicyStatusSchema,
  ModelEvaluationStatusSchema,
  ModelExecutionStatusSchema,
  ModelProviderLifecycleSchema
} from '../model-catalog/model-catalog.schema';
import type { GenerationUsage, ModelProviderCode } from '../agent-kernel/generation.schema';
import type { ModelTier } from '../agent-kernel/agent-kernel.schema';
import type { ProjectStatus, RestorableProjectStatus } from '../projects/project.schema';
import type { TicketQualityReport } from '../work-items/ticket-quality.schema';
import type { WorkItem } from '../work-items/work-item.schema';
import type { EngineeringPlan, EngineeringPlanQualityReport } from '../engineering-plans/engineering-plan.schema';
import type { BusinessContextPreview, BusinessContextProposedGraphChange } from '../experience/business-context.schema';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow()
};

export const organizations = pgTable(
  'organizations',
  {
    id: text('id').primaryKey(),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull().default('ACTIVE'),
    ...timestamps
  },
  (table) => [
    uniqueIndex('organizations_slug_uidx').on(table.slug),
    check('organizations_status_check', sql`${table.status} in ('ACTIVE', 'SUSPENDED', 'DELETED')`)
  ]
);

export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  name: text('name').notNull(),
  rowVersion: integer('row_version').notNull().default(1),
  ...timestamps
});

export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  name: text('name').notNull(),
  status: text('status').$type<ProjectStatus>().notNull(),
  archivedFromStatus: text('archived_from_status').$type<RestorableProjectStatus>(),
  archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'string' }),
  graphVersion: integer('graph_version').notNull().default(0),
  rowVersion: integer('row_version').notNull().default(1),
  ...timestamps
});

export const projectGraphs = pgTable('project_graphs', {
  organizationId: text('organization_id').notNull(),
  projectId: text('project_id').notNull(),
  graphVersion: integer('graph_version').notNull(),
  summary: text('summary').notNull(),
  readiness: jsonb('readiness'),
  analyzer: text('analyzer').notNull(),
  analyzedAt: timestamp('analyzed_at', { withTimezone: true, mode: 'string' }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow()
}, (table) => [primaryKey({ name: 'project_graphs_pk', columns: [table.projectId, table.graphVersion] })]);

export const projectSources = pgTable('project_sources', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  workspaceId: text('workspace_id').notNull(),
  projectId: text('project_id').notNull(),
  name: text('name').notNull(),
  relativePath: text('relative_path'),
  kind: text('kind').notNull(),
  mimeType: text('mime_type').notNull(),
  size: integer('size').notNull(),
  sha256: text('sha256').notNull(),
  extractedText: text('extracted_text').notNull(),
  rawPath: text('raw_path').notNull(),
  status: text('status').notNull(),
  extractionError: text('extraction_error'),
  sourceKey: text('source_key').notNull().default('legacy'),
  version: integer('version').notNull().default(1),
  uploadedByUserId: text('uploaded_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
  validationStatus: text('validation_status').notNull().default('LEGACY_NOT_VERIFIED'),
  validator: text('validator').notNull().default('legacy-import'),
  extractedAt: timestamp('extracted_at', { withTimezone: true, mode: 'string' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull()
}, (table) => [
  uniqueIndex('project_sources_project_key_version_uidx').on(table.organizationId, table.projectId, table.sourceKey, table.version).where(sql`${table.sourceKey} <> 'legacy'`),
  index('project_sources_project_created_idx').on(table.organizationId, table.projectId, table.createdAt, table.id),
  check('project_sources_version_check', sql`${table.version} > 0`),
  check('project_sources_validation_status_check', sql`${table.validationStatus} in ('VALIDATED', 'LEGACY_NOT_VERIFIED')`)
]);

export const analysisRuns = pgTable('analysis_runs', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  projectId: text('project_id').notNull(),
  requestedByUserId: text('requested_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  requestId: text('request_id').notNull(),
  status: text('status').notNull().default('QUEUED'),
  analyzer: text('analyzer').notNull(),
  sourceSnapshotHash: text('source_snapshot_hash').notNull(),
  attempts: integer('attempts').notNull().default(0),
  lockedBy: text('locked_by'),
  lockedAt: timestamp('locked_at', { withTimezone: true, mode: 'string' }),
  startedAt: timestamp('started_at', { withTimezone: true, mode: 'string' }),
  completedAt: timestamp('completed_at', { withTimezone: true, mode: 'string' }),
  cancelledAt: timestamp('cancelled_at', { withTimezone: true, mode: 'string' }),
  graphVersion: integer('graph_version'),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  ...timestamps
}, (table) => [
  uniqueIndex('analysis_runs_scope_id_uidx').on(table.organizationId, table.projectId, table.id),
  index('analysis_runs_queue_idx').on(table.status, table.createdAt, table.id),
  index('analysis_runs_project_created_idx').on(table.organizationId, table.projectId, table.createdAt, table.id),
  check('analysis_runs_status_check', sql`${table.status} in ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')`),
  check('analysis_runs_attempts_check', sql`${table.attempts} >= 0`),
  check('analysis_runs_snapshot_hash_check', sql`${table.sourceSnapshotHash} ~ '^[a-f0-9]{64}$'`)
]);

export const projectDocuments = pgTable('project_documents', {
  id: text('id').notNull(),
  organizationId: text('organization_id').notNull(),
  projectId: text('project_id').notNull(),
  type: text('type').notNull(),
  version: integer('version').notNull(),
  sourceGraphVersion: integer('source_graph_version').notNull(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  sha256: text('sha256').notNull(),
  truthStatus: text('truth_status').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
  generatedAt: timestamp('generated_at', { withTimezone: true, mode: 'string' }).notNull()
}, (table) => [primaryKey({ name: 'project_documents_pk', columns: [table.id, table.version] })]);

export const knowledgeEntities = pgTable('knowledge_entities', {
  id: text('id').notNull(),
  organizationId: text('organization_id').notNull(),
  projectId: text('project_id').notNull(),
  graphVersion: integer('graph_version').notNull(),
  category: text('category').notNull(),
  text: text('text').notNull(),
  truthStatus: text('truth_status').notNull(),
  sourceId: text('source_id'),
  clarificationQuestionId: text('clarification_question_id'),
  quote: text('quote'),
  startOffset: integer('start_offset'),
  endOffset: integer('end_offset'),
  position: integer('position').notNull()
}, (table) => [primaryKey({ name: 'knowledge_entities_pk', columns: [table.id, table.graphVersion] })]);

export const projectGaps = pgTable('project_gaps', {
  id: text('id').notNull(),
  organizationId: text('organization_id').notNull(),
  projectId: text('project_id').notNull(),
  graphVersion: integer('graph_version').notNull(),
  position: integer('position').notNull(),
  type: text('type').notNull(),
  category: text('category').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  severity: text('severity').notNull(),
  impactAreas: jsonb('impact_areas').$type<string[]>().notNull(),
  affectedEntityIds: jsonb('affected_entity_ids').$type<string[]>().notNull(),
  affectedArtifacts: jsonb('affected_artifacts').$type<string[]>().notNull(),
  rationale: text('rationale').notNull(),
  status: text('status').notNull(),
  truthStatus: text('truth_status').notNull()
}, (table) => [primaryKey({ name: 'project_gaps_pk', columns: [table.id, table.graphVersion] })]);

export const clarificationQuestions = pgTable('clarification_questions', {
  id: text('id').notNull(),
  organizationId: text('organization_id').notNull(),
  projectId: text('project_id').notNull(),
  graphVersion: integer('graph_version').notNull(),
  gapId: text('gap_id').notNull(),
  question: text('question').notNull(),
  whyItMatters: text('why_it_matters').notNull(),
  affectedEntityIds: jsonb('affected_entity_ids').$type<string[]>().notNull(),
  options: jsonb('options').$type<unknown[]>().notNull(),
  status: text('status').notNull(),
  answer: text('answer'),
  answeredAt: timestamp('answered_at', { withTimezone: true, mode: 'string' }),
  truthStatus: text('truth_status').notNull(),
  position: integer('position').notNull()
}, (table) => [primaryKey({ name: 'clarification_questions_pk', columns: [table.id, table.graphVersion] })]);

export const documentApprovals = pgTable('document_approvals', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  projectId: text('project_id').notNull(),
  graphVersion: integer('graph_version').notNull(),
  payload: jsonb('payload').notNull(),
  approvedAt: timestamp('approved_at', { withTimezone: true, mode: 'string' }).notNull()
});

export const arbDecisions = pgTable('arb_decisions', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  projectId: text('project_id').notNull(),
  graphVersion: integer('graph_version').notNull(),
  version: integer('version').notNull(),
  payload: jsonb('payload').notNull(),
  approvedAt: timestamp('approved_at', { withTimezone: true, mode: 'string' }).notNull()
});

export const architectureGenerations = pgTable('architecture_generations', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  projectId: text('project_id').notNull(),
  graphVersion: integer('graph_version').notNull(),
  version: integer('version').notNull(),
  contentHash: text('content_hash').notNull(),
  compilerVersion: text('compiler_version').notNull(),
  payload: jsonb('payload').notNull(),
  createdByUserId: text('created_by_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow()
}, (table) => [
  uniqueIndex('architecture_generations_project_version_uidx').on(table.organizationId, table.projectId, table.version),
  uniqueIndex('architecture_generations_scope_id_uidx').on(table.organizationId, table.projectId, table.id),
  index('architecture_generations_project_graph_created_idx').on(table.organizationId, table.projectId, table.graphVersion, table.createdAt, table.id),
  check('architecture_generations_version_check', sql`${table.version} > 0 and ${table.graphVersion} > 0`),
  check('architecture_generations_hash_check', sql`${table.contentHash} ~ '^[a-f0-9]{64}$'`),
  foreignKey({ name: 'architecture_generations_graph_fk', columns: [table.organizationId, table.projectId, table.graphVersion], foreignColumns: [projectGraphs.organizationId, projectGraphs.projectId, projectGraphs.graphVersion] }).onDelete('restrict')
]);

export const architectureOptionVersions = pgTable('architecture_option_versions', {
  generationId: text('generation_id').notNull().references(() => architectureGenerations.id, { onDelete: 'cascade' }),
  organizationId: text('organization_id').notNull(),
  projectId: text('project_id').notNull(),
  optionId: text('option_id').notNull(),
  position: integer('position').notNull(),
  contentHash: text('content_hash').notNull(),
  payload: jsonb('payload').notNull()
}, (table) => [
  primaryKey({ name: 'architecture_option_versions_pk', columns: [table.generationId, table.optionId] }),
  index('architecture_option_versions_scope_generation_idx').on(table.organizationId, table.projectId, table.generationId, table.position),
  check('architecture_option_versions_position_check', sql`${table.position} >= 0`),
  check('architecture_option_versions_hash_check', sql`${table.contentHash} ~ '^[a-f0-9]{64}$'`)
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

export const idempotencyRecords = pgTable('idempotency_records', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  scope: text('scope').notNull(),
  key: text('key').notNull(),
  requestHash: text('request_hash').notNull(),
  status: text('status').notNull().default('PROCESSING'),
  responseStatus: integer('response_status'),
  responsePayload: jsonb('response_payload').$type<Record<string, unknown>>(),
  expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
  ...timestamps
});

export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    status: text('status').notNull().default('ACTIVE'),
    ...timestamps
  },
  (table) => [
    uniqueIndex('users_email_uidx').on(table.email),
    check('users_email_canonical_check', sql`${table.email} = lower(${table.email})`),
    check('users_status_check', sql`${table.status} in ('ACTIVE', 'DISABLED', 'DELETED')`)
  ]
);

export const memberships = pgTable(
  'memberships',
  {
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').$type<OrganizationRole>().notNull(),
    status: text('status').notNull().default('ACTIVE'),
    rowVersion: integer('row_version').notNull().default(1),
    ...timestamps
  },
  (table) => [
    primaryKey({ name: 'memberships_pk', columns: [table.organizationId, table.userId] }),
    index('memberships_user_status_idx').on(table.userId, table.status),
    check(
      'memberships_role_check',
      sql`${table.role} in ('OWNER', 'ADMINISTRATOR', 'PRODUCT_ANALYST', 'ARCHITECT', 'DEVELOPER', 'REVIEWER', 'VIEWER')`
    ),
    check('memberships_status_check', sql`${table.status} in ('ACTIVE', 'INVITED', 'REVOKED')`)
  ]
);

export const organizationInvitations = pgTable(
  'organization_invitations',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role').$type<OrganizationRole>().notNull(),
    status: text('status').notNull().default('PENDING'),
    tokenHash: text('token_hash').notNull(),
    invitedByUserId: text('invited_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    acceptedByUserId: text('accepted_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true, mode: 'string' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'string' }),
    rowVersion: integer('row_version').notNull().default(1),
    ...timestamps
  },
  (table) => [
    uniqueIndex('organization_invitations_token_hash_uidx').on(table.tokenHash),
    uniqueIndex('organization_invitations_pending_email_uidx')
      .on(table.organizationId, table.email)
      .where(sql`${table.status} = 'PENDING'`),
    index('organization_invitations_org_updated_idx').on(table.organizationId, table.updatedAt, table.id),
    check('organization_invitations_email_canonical_check', sql`${table.email} = lower(${table.email})`),
    check(
      'organization_invitations_role_check',
      sql`${table.role} in ('ADMINISTRATOR', 'PRODUCT_ANALYST', 'ARCHITECT', 'DEVELOPER', 'REVIEWER', 'VIEWER')`
    ),
    check(
      'organization_invitations_status_check',
      sql`${table.status} in ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED')`
    ),
    check('organization_invitations_token_hash_check', sql`${table.tokenHash} ~ '^[a-f0-9]{64}$'`),
    check('organization_invitations_row_version_check', sql`${table.rowVersion} > 0`)
  ]
);

export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    status: text('status').notNull().default('ACTIVE'),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'string' }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'string' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'string' }),
    ...timestamps
  },
  (table) => [
    uniqueIndex('sessions_token_hash_uidx').on(table.tokenHash),
    index('sessions_user_status_idx').on(table.userId, table.status),
    index('sessions_expires_at_idx').on(table.expiresAt),
    check('sessions_token_hash_check', sql`${table.tokenHash} ~ '^[a-f0-9]{64}$'`),
    check('sessions_status_check', sql`${table.status} in ('ACTIVE', 'REVOKED', 'EXPIRED')`)
  ]
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'restrict' }),
    actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    requestId: text('request_id').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow()
  },
  (table) => [
    index('audit_events_organization_occurred_idx').on(table.organizationId, table.occurredAt, table.id),
    index('audit_events_actor_occurred_idx').on(table.actorUserId, table.occurredAt),
    index('audit_events_request_idx').on(table.requestId)
  ]
);

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
