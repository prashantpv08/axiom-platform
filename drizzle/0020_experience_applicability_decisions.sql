CREATE TABLE "experience_applicability_decisions" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "project_id" text NOT NULL,
  "previous_graph_version" integer NOT NULL,
  "graph_version" integer NOT NULL,
  "decision" text NOT NULL,
  "rationale" text NOT NULL,
  "source_preview_content_hash" text NOT NULL,
  "truth_status" text NOT NULL,
  "decided_by_user_id" text NOT NULL,
  "decided_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "experience_applicability_decisions_graph_check" CHECK ("previous_graph_version" > 0 and "graph_version" = "previous_graph_version" + 1),
  CONSTRAINT "experience_applicability_decisions_decision_check" CHECK ("decision" in ('APPLICABLE', 'NOT_APPLICABLE')),
  CONSTRAINT "experience_applicability_decisions_truth_check" CHECK ("truth_status" = 'HUMAN_CONFIRMED'),
  CONSTRAINT "experience_applicability_decisions_hash_check" CHECK ("source_preview_content_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "experience_applicability_decisions" ADD CONSTRAINT "experience_applicability_decisions_graph_fk" FOREIGN KEY ("organization_id","project_id","graph_version") REFERENCES "project_graphs"("organization_id","project_id","graph_version") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "experience_applicability_decisions" ADD CONSTRAINT "experience_applicability_decisions_user_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "users"("id") ON DELETE restrict;--> statement-breakpoint
CREATE UNIQUE INDEX "experience_applicability_decisions_project_graph_uidx" ON "experience_applicability_decisions" ("organization_id","project_id","graph_version");--> statement-breakpoint
CREATE UNIQUE INDEX "experience_applicability_decisions_scope_id_uidx" ON "experience_applicability_decisions" ("organization_id","project_id","id");--> statement-breakpoint
CREATE INDEX "experience_applicability_decisions_project_decided_idx" ON "experience_applicability_decisions" ("organization_id","project_id","decided_at","id");
