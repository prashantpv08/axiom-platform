CREATE TABLE "arb_decisions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"graph_version" integer NOT NULL,
	"version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	CONSTRAINT "arb_decisions_version_check" CHECK ("arb_decisions"."version" > 0 and "arb_decisions"."graph_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "architecture_briefs" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"graph_version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "architecture_options" (
	"id" text NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"graph_version" integer NOT NULL,
	"recommended" text NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "architecture_options_pk" PRIMARY KEY("id","graph_version"),
	CONSTRAINT "architecture_options_recommended_check" CHECK ("architecture_options"."recommended" in ('true', 'false'))
);
--> statement-breakpoint
CREATE TABLE "clarification_questions" (
	"id" text NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"graph_version" integer NOT NULL,
	"gap_id" text NOT NULL,
	"question" text NOT NULL,
	"why_it_matters" text NOT NULL,
	"affected_entity_ids" jsonb NOT NULL,
	"options" jsonb NOT NULL,
	"status" text NOT NULL,
	"answer" text,
	"answered_at" timestamp with time zone,
	"truth_status" text NOT NULL,
	CONSTRAINT "clarification_questions_pk" PRIMARY KEY("id","graph_version"),
	CONSTRAINT "clarification_questions_status_check" CHECK ("clarification_questions"."status" in ('OPEN', 'ANSWERED')),
	CONSTRAINT "clarification_questions_truth_status_check" CHECK ("clarification_questions"."truth_status" in ('UNKNOWN', 'HUMAN_CONFIRMED'))
);
--> statement-breakpoint
CREATE TABLE "document_approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"graph_version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"approved_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"scope" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" text DEFAULT 'PROCESSING' NOT NULL,
	"response_status" integer,
	"response_payload" jsonb,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_records_status_check" CHECK ("idempotency_records"."status" in ('PROCESSING', 'COMPLETED', 'FAILED')),
	CONSTRAINT "idempotency_records_request_hash_check" CHECK ("idempotency_records"."request_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "jira_publications" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"source_graph_version" integer NOT NULL,
	"plan_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_entities" (
	"id" text NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"graph_version" integer NOT NULL,
	"category" text NOT NULL,
	"text" text NOT NULL,
	"truth_status" text NOT NULL,
	"source_id" text,
	"clarification_question_id" text,
	"quote" text,
	"start_offset" integer,
	"end_offset" integer,
	CONSTRAINT "knowledge_entities_pk" PRIMARY KEY("id","graph_version"),
	CONSTRAINT "knowledge_entities_offsets_check" CHECK (("knowledge_entities"."start_offset" is null and "knowledge_entities"."end_offset" is null) or ("knowledge_entities"."start_offset" >= 0 and "knowledge_entities"."end_offset" > "knowledge_entities"."start_offset")),
	CONSTRAINT "knowledge_entities_truth_status_check" CHECK ("knowledge_entities"."truth_status" in ('SOURCE_GROUNDED', 'HUMAN_CONFIRMED', 'UNKNOWN'))
);
--> statement-breakpoint
CREATE TABLE "notion_publications" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"source_graph_version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"published_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_status_check" CHECK ("organizations"."status" in ('ACTIVE', 'SUSPENDED', 'DELETED')),
	CONSTRAINT "organizations_row_version_check" CHECK ("organizations"."row_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"event_type" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_events_status_check" CHECK ("outbox_events"."status" in ('PENDING', 'PROCESSING', 'PUBLISHED', 'FAILED')),
	CONSTRAINT "outbox_events_attempts_check" CHECK ("outbox_events"."attempts" >= 0)
);
--> statement-breakpoint
CREATE TABLE "project_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"type" text NOT NULL,
	"version" integer NOT NULL,
	"source_graph_version" integer NOT NULL,
	"title" text NOT NULL,
	"content" text NOT NULL,
	"sha256" text NOT NULL,
	"truth_status" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "project_documents_version_check" CHECK ("project_documents"."version" > 0 and "project_documents"."source_graph_version" > 0),
	CONSTRAINT "project_documents_sha256_check" CHECK ("project_documents"."sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "project_documents_type_check" CHECK ("project_documents"."type" in ('requirements', 'srs', 'nfr', 'hld', 'adr'))
);
--> statement-breakpoint
CREATE TABLE "project_gaps" (
	"id" text NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"graph_version" integer NOT NULL,
	"type" text NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"severity" text NOT NULL,
	"impact_areas" jsonb NOT NULL,
	"affected_entity_ids" jsonb NOT NULL,
	"affected_artifacts" jsonb NOT NULL,
	"rationale" text NOT NULL,
	"status" text NOT NULL,
	"truth_status" text NOT NULL,
	CONSTRAINT "project_gaps_pk" PRIMARY KEY("id","graph_version")
);
--> statement-breakpoint
CREATE TABLE "project_graphs" (
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"graph_version" integer NOT NULL,
	"summary" text NOT NULL,
	"readiness" jsonb,
	"analyzer" text NOT NULL,
	"analyzed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_graphs_pk" PRIMARY KEY("project_id","graph_version"),
	CONSTRAINT "project_graphs_version_check" CHECK ("project_graphs"."graph_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "project_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"relative_path" text,
	"kind" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"extracted_text" text NOT NULL,
	"raw_path" text NOT NULL,
	"status" text NOT NULL,
	"extraction_error" text,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "project_sources_size_check" CHECK ("project_sources"."size" >= 0),
	CONSTRAINT "project_sources_kind_check" CHECK ("project_sources"."kind" in ('FILE', 'FOLDER_FILE', 'MEETING_TRANSCRIPT')),
	CONSTRAINT "project_sources_status_check" CHECK ("project_sources"."status" in ('EXTRACTED', 'FAILED')),
	CONSTRAINT "project_sources_sha256_check" CHECK ("project_sources"."sha256" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text NOT NULL,
	"graph_version" integer DEFAULT 0 NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_graph_version_check" CHECK ("projects"."graph_version" >= 0),
	CONSTRAINT "projects_row_version_check" CHECK ("projects"."row_version" > 0),
	CONSTRAINT "projects_status_check" CHECK ("projects"."status" in ('DRAFT', 'SOURCES_READY', 'ANALYZED', 'NEEDS_CLARIFICATION', 'DOCUMENTED', 'DOCUMENTS_APPROVED', 'DESIGN_READY', 'ARB_APPROVED', 'HLD_READY', 'PUBLISHED', 'BACKLOG_READY'))
);
--> statement-breakpoint
CREATE TABLE "prototype_imports" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"source_hash" text NOT NULL,
	"status" text NOT NULL,
	"counts" jsonb NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "prototype_imports_status_check" CHECK ("prototype_imports"."status" in ('RUNNING', 'COMPLETED', 'FAILED'))
);
--> statement-breakpoint
CREATE TABLE "tech_stack_recommendations" (
	"id" text NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"graph_version" integer NOT NULL,
	"layer" text NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "tech_stack_recommendations_pk" PRIMARY KEY("id","graph_version")
);
--> statement-breakpoint
CREATE TABLE "wireframe_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"source_graph_version" integer NOT NULL,
	"screen_id" text NOT NULL,
	"revision" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "wireframe_revisions_revision_check" CHECK ("wireframe_revisions"."revision" > 0 and "wireframe_revisions"."source_graph_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_row_version_check" CHECK ("workspaces"."row_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_organization_id_id_uidx" ON "workspaces" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_organization_id_id_uidx" ON "projects" USING btree ("organization_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_graphs_organization_project_version_uidx" ON "project_graphs" USING btree ("organization_id","project_id","graph_version");--> statement-breakpoint
CREATE UNIQUE INDEX "project_gaps_scope_id_version_uidx" ON "project_gaps" USING btree ("organization_id","project_id","graph_version","id");--> statement-breakpoint
CREATE UNIQUE INDEX "clarification_questions_scope_id_version_uidx" ON "clarification_questions" USING btree ("organization_id","project_id","graph_version","id");--> statement-breakpoint
ALTER TABLE "arb_decisions" ADD CONSTRAINT "arb_decisions_organization_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "architecture_briefs" ADD CONSTRAINT "architecture_briefs_organization_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "architecture_options" ADD CONSTRAINT "architecture_options_graph_fk" FOREIGN KEY ("organization_id","project_id","graph_version") REFERENCES "public"."project_graphs"("organization_id","project_id","graph_version") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clarification_questions" ADD CONSTRAINT "clarification_questions_graph_fk" FOREIGN KEY ("organization_id","project_id","graph_version") REFERENCES "public"."project_graphs"("organization_id","project_id","graph_version") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clarification_questions" ADD CONSTRAINT "clarification_questions_gap_fk" FOREIGN KEY ("organization_id","project_id","graph_version","gap_id") REFERENCES "public"."project_gaps"("organization_id","project_id","graph_version","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_approvals" ADD CONSTRAINT "document_approvals_organization_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jira_publications" ADD CONSTRAINT "jira_publications_organization_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_entities" ADD CONSTRAINT "knowledge_entities_source_id_project_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."project_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_entities" ADD CONSTRAINT "knowledge_entities_graph_fk" FOREIGN KEY ("organization_id","project_id","graph_version") REFERENCES "public"."project_graphs"("organization_id","project_id","graph_version") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_entities" ADD CONSTRAINT "knowledge_entities_clarification_fk" FOREIGN KEY ("organization_id","project_id","graph_version","clarification_question_id") REFERENCES "public"."clarification_questions"("organization_id","project_id","graph_version","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notion_publications" ADD CONSTRAINT "notion_publications_organization_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_organization_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_gaps" ADD CONSTRAINT "project_gaps_graph_fk" FOREIGN KEY ("organization_id","project_id","graph_version") REFERENCES "public"."project_graphs"("organization_id","project_id","graph_version") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_graphs" ADD CONSTRAINT "project_graphs_organization_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_sources" ADD CONSTRAINT "project_sources_organization_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_sources" ADD CONSTRAINT "project_sources_organization_workspace_fk" FOREIGN KEY ("organization_id","workspace_id") REFERENCES "public"."workspaces"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_workspace_fk" FOREIGN KEY ("organization_id","workspace_id") REFERENCES "public"."workspaces"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prototype_imports" ADD CONSTRAINT "prototype_imports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tech_stack_recommendations" ADD CONSTRAINT "tech_stack_recommendations_graph_fk" FOREIGN KEY ("organization_id","project_id","graph_version") REFERENCES "public"."project_graphs"("organization_id","project_id","graph_version") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wireframe_revisions" ADD CONSTRAINT "wireframe_revisions_organization_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "public"."projects"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspaces" ADD CONSTRAINT "workspaces_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "arb_decisions_project_version_uidx" ON "arb_decisions" USING btree ("organization_id","project_id","version");--> statement-breakpoint
CREATE INDEX "arb_decisions_project_approved_idx" ON "arb_decisions" USING btree ("organization_id","project_id","approved_at");--> statement-breakpoint
CREATE UNIQUE INDEX "architecture_briefs_project_graph_uidx" ON "architecture_briefs" USING btree ("organization_id","project_id","graph_version");--> statement-breakpoint
CREATE UNIQUE INDEX "architecture_options_scope_id_version_uidx" ON "architecture_options" USING btree ("organization_id","project_id","graph_version","id");--> statement-breakpoint
CREATE INDEX "architecture_options_organization_project_graph_idx" ON "architecture_options" USING btree ("organization_id","project_id","graph_version");--> statement-breakpoint
CREATE INDEX "clarification_questions_organization_project_graph_idx" ON "clarification_questions" USING btree ("organization_id","project_id","graph_version");--> statement-breakpoint
CREATE UNIQUE INDEX "document_approvals_project_uidx" ON "document_approvals" USING btree ("organization_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_records_organization_scope_key_uidx" ON "idempotency_records" USING btree ("organization_id","scope","key");--> statement-breakpoint
CREATE INDEX "idempotency_records_expiry_idx" ON "idempotency_records" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jira_publications_project_uidx" ON "jira_publications" USING btree ("organization_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jira_publications_plan_hash_uidx" ON "jira_publications" USING btree ("organization_id","project_id","plan_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_entities_scope_id_version_uidx" ON "knowledge_entities" USING btree ("organization_id","project_id","graph_version","id");--> statement-breakpoint
CREATE INDEX "knowledge_entities_organization_project_graph_idx" ON "knowledge_entities" USING btree ("organization_id","project_id","graph_version");--> statement-breakpoint
CREATE INDEX "knowledge_entities_source_idx" ON "knowledge_entities" USING btree ("organization_id","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notion_publications_project_uidx" ON "notion_publications" USING btree ("organization_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organizations_slug_uidx" ON "organizations" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_events_organization_idempotency_uidx" ON "outbox_events" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "outbox_events_dispatch_idx" ON "outbox_events" USING btree ("status","available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "project_documents_project_type_version_uidx" ON "project_documents" USING btree ("organization_id","project_id","type","version");--> statement-breakpoint
CREATE INDEX "project_documents_project_graph_idx" ON "project_documents" USING btree ("organization_id","project_id","source_graph_version");--> statement-breakpoint
CREATE INDEX "project_gaps_organization_project_graph_idx" ON "project_gaps" USING btree ("organization_id","project_id","graph_version");--> statement-breakpoint
CREATE INDEX "project_graphs_organization_project_idx" ON "project_graphs" USING btree ("organization_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_sources_organization_id_id_uidx" ON "project_sources" USING btree ("organization_id","id");--> statement-breakpoint
CREATE INDEX "project_sources_organization_project_idx" ON "project_sources" USING btree ("organization_id","project_id");--> statement-breakpoint
CREATE INDEX "project_sources_sha256_idx" ON "project_sources" USING btree ("organization_id","sha256");--> statement-breakpoint
CREATE INDEX "projects_organization_workspace_idx" ON "projects" USING btree ("organization_id","workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prototype_imports_organization_source_hash_uidx" ON "prototype_imports" USING btree ("organization_id","source_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "tech_stack_recommendations_scope_id_version_uidx" ON "tech_stack_recommendations" USING btree ("organization_id","project_id","graph_version","id");--> statement-breakpoint
CREATE INDEX "tech_stack_recommendations_organization_project_graph_idx" ON "tech_stack_recommendations" USING btree ("organization_id","project_id","graph_version");--> statement-breakpoint
CREATE UNIQUE INDEX "wireframe_revisions_project_screen_revision_uidx" ON "wireframe_revisions" USING btree ("organization_id","project_id","screen_id","revision");--> statement-breakpoint
CREATE INDEX "workspaces_organization_id_idx" ON "workspaces" USING btree ("organization_id");
