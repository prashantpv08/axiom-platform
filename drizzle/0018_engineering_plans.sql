CREATE TABLE "engineering_plan_generations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"source_graph_version" integer NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"content_hash" text NOT NULL,
	"schema_version" text NOT NULL,
	"evaluator_version" text NOT NULL,
	"prompt_version" text NOT NULL,
	"workflow_version" text NOT NULL,
	"reference_catalog_version" text NOT NULL,
	"artifact_approval_id" text NOT NULL,
	"architecture_decision_id" text NOT NULL,
	"architecture_option_id" text NOT NULL,
	"agent_run_id" text NOT NULL,
	"plan" jsonb NOT NULL,
	"quality_report" jsonb NOT NULL,
	"created_by_user_id" text NOT NULL,
	"request_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "engineering_plan_generations_version_check" CHECK ("version" > 0 and "source_graph_version" > 0),
	CONSTRAINT "engineering_plan_generations_status_check" CHECK ("status" = 'DRAFT'),
	CONSTRAINT "engineering_plan_generations_hash_check" CHECK ("content_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "engineering_plan_generations" ADD CONSTRAINT "engineering_plan_generations_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "projects"("organization_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "engineering_plan_generations" ADD CONSTRAINT "engineering_plan_generations_graph_fk" FOREIGN KEY ("organization_id","project_id","source_graph_version") REFERENCES "project_graphs"("organization_id","project_id","graph_version") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "engineering_plan_generations" ADD CONSTRAINT "engineering_plan_generations_agent_run_fk" FOREIGN KEY ("organization_id","agent_run_id") REFERENCES "agent_runs"("organization_id","id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "engineering_plan_generations" ADD CONSTRAINT "engineering_plan_generations_creator_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE restrict;
--> statement-breakpoint
CREATE UNIQUE INDEX "engineering_plan_generations_project_version_uidx" ON "engineering_plan_generations" ("organization_id","project_id","version");
--> statement-breakpoint
CREATE UNIQUE INDEX "engineering_plan_generations_scope_id_uidx" ON "engineering_plan_generations" ("organization_id","project_id","id");
--> statement-breakpoint
CREATE INDEX "engineering_plan_generations_project_created_idx" ON "engineering_plan_generations" ("organization_id","project_id","created_at","id");
--> statement-breakpoint
INSERT INTO "prompt_versions" ("id", "prompt", "version", "template", "template_sha256", "status") VALUES
	('PROMPT-ENGINEERING-PLAN-V1', 'engineering-plan-grounded', 'engineering-plan-grounded-v1', 'Create a complete source-grounded Engineering Plan for all required software delivery lifecycle domains. Explain recommended and not-recommended choices, trade-offs, risks, actions, verification, approved source IDs, controlled references, and unknowns. Never assert unexecuted evidence or perform an external action.', '26ab14fe51016dfe1078b90dcad51ef928559b73d750b75c6244622a15bf3645', 'ACTIVE');
--> statement-breakpoint
INSERT INTO "agent_workflow_versions" ("id", "workflow", "version", "prompt_version", "schema_version", "evaluator_version", "maximum_attempts", "allowed_tools", "status") VALUES
	('AWFV-ENGINEERING-PLAN-V1', 'engineering-plan', 'engineering-plan-workflow-v1', 'engineering-plan-grounded-v1', 'engineering-plan-v1', 'engineering-plan-quality-v1', 2, ARRAY[]::text[], 'ACTIVE');
--> statement-breakpoint
CREATE TRIGGER engineering_plan_generations_immutable BEFORE UPDATE OR DELETE ON engineering_plan_generations FOR EACH ROW EXECUTE FUNCTION axiom_prevent_agent_evidence_update();
