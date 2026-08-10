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
import { projectGraphs } from './projects.schema';

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

