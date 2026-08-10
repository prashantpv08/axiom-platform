import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex
} from 'drizzle-orm/pg-core';
import { users } from './identity.schema';
import { timestamps } from './timestamps';

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
