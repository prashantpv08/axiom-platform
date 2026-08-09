CREATE TABLE "business_context_versions" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "project_id" text NOT NULL,
  "graph_version" integer NOT NULL,
  "version" integer NOT NULL,
  "content_hash" text NOT NULL,
  "compiler_version" text NOT NULL,
  "payload" jsonb NOT NULL,
  "generated_by_user_id" text NOT NULL,
  "generated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "business_context_versions_version_check" CHECK ("version" > 0 and "graph_version" > 0),
  CONSTRAINT "business_context_versions_hash_check" CHECK ("content_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "business_context_reviews" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "project_id" text NOT NULL,
  "graph_version" integer NOT NULL,
  "context_version_id" text NOT NULL,
  "context_content_hash" text NOT NULL,
  "decision" text NOT NULL,
  "feedback_category" text NOT NULL,
  "comment" text NOT NULL,
  "proposed_graph_changes" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "truth_status" text NOT NULL,
  "reviewed_by_user_id" text NOT NULL,
  "reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "business_context_reviews_hash_check" CHECK ("context_content_hash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "business_context_reviews_decision_check" CHECK ("decision" in ('ACCEPT', 'ACCEPT_WITH_EDITS', 'REJECT')),
  CONSTRAINT "business_context_reviews_truth_check" CHECK ("truth_status" in ('HUMAN_APPROVED', 'HUMAN_REVIEWED'))
);
--> statement-breakpoint
ALTER TABLE "business_context_versions" ADD CONSTRAINT "business_context_versions_graph_fk" FOREIGN KEY ("organization_id","project_id","graph_version") REFERENCES "project_graphs"("organization_id","project_id","graph_version") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "business_context_versions" ADD CONSTRAINT "business_context_versions_user_fk" FOREIGN KEY ("generated_by_user_id") REFERENCES "users"("id") ON DELETE restrict;--> statement-breakpoint
CREATE UNIQUE INDEX "business_context_versions_project_version_uidx" ON "business_context_versions" ("organization_id","project_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "business_context_versions_scope_id_uidx" ON "business_context_versions" ("organization_id","project_id","id");--> statement-breakpoint
CREATE INDEX "business_context_versions_project_graph_created_idx" ON "business_context_versions" ("organization_id","project_id","graph_version","generated_at","id");--> statement-breakpoint
ALTER TABLE "business_context_reviews" ADD CONSTRAINT "business_context_reviews_graph_fk" FOREIGN KEY ("organization_id","project_id","graph_version") REFERENCES "project_graphs"("organization_id","project_id","graph_version") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "business_context_reviews" ADD CONSTRAINT "business_context_reviews_version_fk" FOREIGN KEY ("organization_id","project_id","context_version_id") REFERENCES "business_context_versions"("organization_id","project_id","id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "business_context_reviews" ADD CONSTRAINT "business_context_reviews_user_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE restrict;--> statement-breakpoint
CREATE UNIQUE INDEX "business_context_reviews_context_uidx" ON "business_context_reviews" ("organization_id","project_id","context_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "business_context_reviews_scope_id_uidx" ON "business_context_reviews" ("organization_id","project_id","id");--> statement-breakpoint
CREATE INDEX "business_context_reviews_project_graph_reviewed_idx" ON "business_context_reviews" ("organization_id","project_id","graph_version","reviewed_at","id");
