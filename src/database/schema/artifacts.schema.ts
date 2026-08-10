import {
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp
} from 'drizzle-orm/pg-core';

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

export const documentApprovals = pgTable('document_approvals', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull(),
  projectId: text('project_id').notNull(),
  graphVersion: integer('graph_version').notNull(),
  payload: jsonb('payload').notNull(),
  approvedAt: timestamp('approved_at', { withTimezone: true, mode: 'string' }).notNull()
});

