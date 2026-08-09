CREATE TABLE "prompt_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"prompt" text NOT NULL,
	"version" text NOT NULL,
	"template" text NOT NULL,
	"template_sha256" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prompt_versions_hash_check" CHECK ("template_sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "prompt_versions_status_check" CHECK ("status" in ('ACTIVE', 'RETIRED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_versions_prompt_version_uidx" ON "prompt_versions" ("prompt", "version");
--> statement-breakpoint
CREATE TABLE "agent_workflow_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"workflow" text NOT NULL,
	"version" text NOT NULL,
	"prompt_version" text NOT NULL,
	"schema_version" text NOT NULL,
	"evaluator_version" text NOT NULL,
	"maximum_attempts" integer NOT NULL,
	"allowed_tools" text[] NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_workflow_versions_attempts_check" CHECK ("maximum_attempts" between 1 and 3),
	CONSTRAINT "agent_workflow_versions_status_check" CHECK ("status" in ('ACTIVE', 'RETIRED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_workflow_versions_workflow_version_uidx" ON "agent_workflow_versions" ("workflow", "version");
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text,
	"generation_id" text NOT NULL,
	"workflow" text NOT NULL,
	"workflow_version" text NOT NULL,
	"prompt_version" text NOT NULL,
	"policy_id" text NOT NULL,
	"policy_version" integer NOT NULL,
	"tier" text NOT NULL,
	"model_definition_id" text NOT NULL,
	"status" text DEFAULT 'RUNNING' NOT NULL,
	"budget_status" text NOT NULL,
	"budget_reason" text,
	"budget_reservation_id" text,
	"context_hash" text NOT NULL,
	"output_hash" text,
	"final_model_call_id" text,
	"error_code" text,
	"request_id" text NOT NULL,
	"actor_user_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "agent_runs_policy_version_check" CHECK ("policy_version" > 0),
	CONSTRAINT "agent_runs_tier_check" CHECK ("tier" in ('ECONOMY', 'BALANCED', 'BEST')),
	CONSTRAINT "agent_runs_status_check" CHECK ("status" in ('RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
	CONSTRAINT "agent_runs_context_hash_check" CHECK ("context_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "agent_runs_output_hash_check" CHECK ("output_hash" is null or "output_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "agent_runs_budget_check" CHECK (("budget_status" = 'NOT_APPLICABLE' and "budget_reason" = 'NON_BILLABLE_LOCAL_FIXTURE' and "budget_reservation_id" is null) or ("budget_status" = 'RESERVED' and "budget_reason" is null and "budget_reservation_id" is not null)),
	CONSTRAINT "agent_runs_terminal_check" CHECK (("status" = 'RUNNING' and "completed_at" is null and "output_hash" is null and "error_code" is null) or ("status" = 'SUCCEEDED' and "completed_at" is not null and "output_hash" is not null and "final_model_call_id" is not null and "error_code" is null) or ("status" in ('FAILED', 'CANCELLED') and "completed_at" is not null and "output_hash" is null and "error_code" is not null))
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_policy_fk" FOREIGN KEY ("policy_id") REFERENCES "model_policies"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_model_definition_fk" FOREIGN KEY ("model_definition_id") REFERENCES "model_definitions"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_actor_fk" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE restrict;
--> statement-breakpoint
CREATE UNIQUE INDEX "agent_runs_organization_id_uidx" ON "agent_runs" ("organization_id", "id");
--> statement-breakpoint
CREATE INDEX "agent_runs_project_started_idx" ON "agent_runs" ("organization_id", "project_id", "started_at", "id");
--> statement-breakpoint
CREATE INDEX "agent_runs_generation_idx" ON "agent_runs" ("organization_id", "generation_id");
--> statement-breakpoint
CREATE TABLE "model_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"run_id" text NOT NULL,
	"attempt" integer NOT NULL,
	"provider" text NOT NULL,
	"model_definition_id" text NOT NULL,
	"immutable_model_id" text NOT NULL,
	"status" text NOT NULL,
	"request_hash" text NOT NULL,
	"response_hash" text,
	"provider_request_id" text,
	"finish_reason" text,
	"usage" jsonb,
	"latency_ms" integer NOT NULL,
	"error_code" text,
	"retryable" boolean DEFAULT false NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "model_calls_attempt_check" CHECK ("attempt" between 1 and 3),
	CONSTRAINT "model_calls_provider_check" CHECK ("provider" in ('LOCAL_FIXTURE', 'OPENAI', 'GROQ')),
	CONSTRAINT "model_calls_status_check" CHECK ("status" in ('SUCCEEDED', 'FAILED')),
	CONSTRAINT "model_calls_request_hash_check" CHECK ("request_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "model_calls_response_hash_check" CHECK ("response_hash" is null or "response_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "model_calls_latency_check" CHECK ("latency_ms" >= 0),
	CONSTRAINT "model_calls_result_check" CHECK (("status" = 'SUCCEEDED' and "response_hash" is not null and "finish_reason" is not null and "usage" is not null and "error_code" is null) or ("status" = 'FAILED' and "response_hash" is null and "finish_reason" is null and "usage" is null and "error_code" is not null))
);
--> statement-breakpoint
ALTER TABLE "model_calls" ADD CONSTRAINT "model_calls_run_scope_fk" FOREIGN KEY ("organization_id", "run_id") REFERENCES "agent_runs"("organization_id", "id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "model_calls" ADD CONSTRAINT "model_calls_model_definition_fk" FOREIGN KEY ("model_definition_id") REFERENCES "model_definitions"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_final_model_call_fk" FOREIGN KEY ("final_model_call_id") REFERENCES "model_calls"("id") ON DELETE restrict;
--> statement-breakpoint
CREATE UNIQUE INDEX "model_calls_run_attempt_uidx" ON "model_calls" ("organization_id", "run_id", "attempt");
--> statement-breakpoint
CREATE INDEX "model_calls_organization_occurred_idx" ON "model_calls" ("organization_id", "occurred_at", "id");
--> statement-breakpoint
ALTER TABLE "work_item_generations" ADD COLUMN "agent_run_id" text;
--> statement-breakpoint
ALTER TABLE "work_item_generations" ADD CONSTRAINT "work_item_generations_agent_run_scope_fk" FOREIGN KEY ("organization_id", "agent_run_id") REFERENCES "agent_runs"("organization_id", "id") ON DELETE restrict;
--> statement-breakpoint
CREATE UNIQUE INDEX "work_item_generations_agent_run_uidx" ON "work_item_generations" ("organization_id", "agent_run_id") WHERE "agent_run_id" IS NOT NULL;
--> statement-breakpoint
INSERT INTO "prompt_versions" ("id", "prompt", "version", "template", "template_sha256", "status") VALUES
	('PROMPT-TICKET-GROUNDED-AGILE-V1', 'ticket-grounded-agile', 'fixture-grounded-agile-v1', 'Generate a connector-neutral Agile WorkItem v1 backlog only from the supplied approved graph entities. Preserve source IDs, identify critical unknowns, and never claim tool execution or external publication.', '272427c3c8beeaa2b4dd0be027715855f25ef325ce4128ee7df1bdf9e7059cff', 'ACTIVE');
--> statement-breakpoint
INSERT INTO "agent_workflow_versions" ("id", "workflow", "version", "prompt_version", "schema_version", "evaluator_version", "maximum_attempts", "allowed_tools", "status") VALUES
	('AWFV-TICKET-WORKFLOW-V1', 'ticket-generation', 'ticket-workflow-v1', 'fixture-grounded-agile-v1', 'work-item-v1', 'ticket-quality-v1', 2, ARRAY[]::text[], 'ACTIVE');
--> statement-breakpoint
CREATE OR REPLACE FUNCTION axiom_prevent_agent_evidence_update() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'agent evidence is immutable'; END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER prompt_versions_immutable BEFORE UPDATE OR DELETE ON prompt_versions FOR EACH ROW EXECUTE FUNCTION axiom_prevent_agent_evidence_update();
--> statement-breakpoint
CREATE TRIGGER agent_workflow_versions_immutable BEFORE UPDATE OR DELETE ON agent_workflow_versions FOR EACH ROW EXECUTE FUNCTION axiom_prevent_agent_evidence_update();
--> statement-breakpoint
CREATE TRIGGER model_calls_immutable BEFORE UPDATE OR DELETE ON model_calls FOR EACH ROW EXECUTE FUNCTION axiom_prevent_agent_evidence_update();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION axiom_guard_agent_run_update() RETURNS trigger AS $$
BEGIN
	IF OLD.status <> 'RUNNING' THEN RAISE EXCEPTION 'terminal agent runs are immutable'; END IF;
	IF NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.project_id IS DISTINCT FROM OLD.project_id OR NEW.generation_id IS DISTINCT FROM OLD.generation_id OR NEW.workflow IS DISTINCT FROM OLD.workflow OR NEW.workflow_version IS DISTINCT FROM OLD.workflow_version OR NEW.prompt_version IS DISTINCT FROM OLD.prompt_version OR NEW.policy_id IS DISTINCT FROM OLD.policy_id OR NEW.policy_version IS DISTINCT FROM OLD.policy_version OR NEW.tier IS DISTINCT FROM OLD.tier OR NEW.model_definition_id IS DISTINCT FROM OLD.model_definition_id OR NEW.budget_status IS DISTINCT FROM OLD.budget_status OR NEW.budget_reason IS DISTINCT FROM OLD.budget_reason OR NEW.budget_reservation_id IS DISTINCT FROM OLD.budget_reservation_id OR NEW.context_hash IS DISTINCT FROM OLD.context_hash OR NEW.request_id IS DISTINCT FROM OLD.request_id OR NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id OR NEW.started_at IS DISTINCT FROM OLD.started_at THEN RAISE EXCEPTION 'agent run provenance is immutable'; END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER agent_runs_guarded BEFORE UPDATE ON agent_runs FOR EACH ROW EXECUTE FUNCTION axiom_guard_agent_run_update();
