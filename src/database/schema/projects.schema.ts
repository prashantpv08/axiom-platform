import {
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp
} from 'drizzle-orm/pg-core';
import { timestamps } from './timestamps';
import type { ProjectStatus, RestorableProjectStatus } from '../../projects/project.schema';

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

