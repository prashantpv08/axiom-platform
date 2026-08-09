CREATE TABLE "model_providers" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"display_name" text NOT NULL,
	"lifecycle_status" text NOT NULL,
	"execution_status" text NOT NULL,
	"data_policy_status" text NOT NULL,
	"allowed_regions" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_providers_code_check" CHECK ("model_providers"."code" in ('LOCAL_FIXTURE', 'OPENAI', 'GROQ')),
	CONSTRAINT "model_providers_lifecycle_check" CHECK ("model_providers"."lifecycle_status" in ('LOCAL_ONLY', 'CANDIDATE', 'QUALIFIED', 'SUSPENDED', 'RETIRED')),
	CONSTRAINT "model_providers_execution_check" CHECK ("model_providers"."execution_status" in ('ENABLED', 'DISABLED')),
	CONSTRAINT "model_providers_data_policy_check" CHECK ("model_providers"."data_policy_status" in ('NO_EXTERNAL_TRANSFER', 'REQUIRES_REVIEW', 'APPROVED')),
	CONSTRAINT "model_providers_enabled_lifecycle_check" CHECK ("model_providers"."execution_status" = 'DISABLED' or "model_providers"."lifecycle_status" in ('LOCAL_ONLY', 'QUALIFIED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "model_providers_code_uidx" ON "model_providers" ("code");
--> statement-breakpoint
CREATE TABLE "model_definitions" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"immutable_model_id" text NOT NULL,
	"display_name" text NOT NULL,
	"lifecycle_status" text NOT NULL,
	"execution_status" text NOT NULL,
	"capabilities" jsonb NOT NULL,
	"context_window_tokens" integer,
	"max_output_tokens" integer,
	"pricing" jsonb NOT NULL,
	"data_policy_status" text NOT NULL,
	"allowed_regions" text[] NOT NULL,
	"evaluation_status" text NOT NULL,
	"evaluation_scores" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"evaluation_run_id" text,
	"evaluated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_definitions_provider_fk" FOREIGN KEY ("provider_id") REFERENCES "model_providers"("id") ON DELETE restrict,
	CONSTRAINT "model_definitions_lifecycle_check" CHECK ("model_definitions"."lifecycle_status" in ('LOCAL_ONLY', 'CANDIDATE', 'QUALIFIED', 'SUSPENDED', 'RETIRED')),
	CONSTRAINT "model_definitions_execution_check" CHECK ("model_definitions"."execution_status" in ('ENABLED', 'DISABLED')),
	CONSTRAINT "model_definitions_enabled_lifecycle_check" CHECK ("model_definitions"."execution_status" = 'DISABLED' or "model_definitions"."lifecycle_status" in ('LOCAL_ONLY', 'QUALIFIED')),
	CONSTRAINT "model_definitions_context_check" CHECK ("model_definitions"."context_window_tokens" is null or "model_definitions"."context_window_tokens" > 0),
	CONSTRAINT "model_definitions_output_check" CHECK ("model_definitions"."max_output_tokens" is null or "model_definitions"."max_output_tokens" > 0),
	CONSTRAINT "model_definitions_pricing_check" CHECK ("model_definitions"."pricing"->>'status' in ('NOT_APPLICABLE', 'UNVERIFIED', 'VERIFIED')),
	CONSTRAINT "model_definitions_data_policy_check" CHECK ("model_definitions"."data_policy_status" in ('NO_EXTERNAL_TRANSFER', 'REQUIRES_REVIEW', 'APPROVED')),
	CONSTRAINT "model_definitions_evaluation_check" CHECK ("model_definitions"."evaluation_status" in ('LOCAL_FIXTURE_ONLY', 'NOT_EVALUATED', 'QUALIFIED', 'FAILED'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "model_definitions_provider_model_uidx" ON "model_definitions" ("provider_id", "immutable_model_id");
--> statement-breakpoint
CREATE INDEX "model_definitions_provider_lifecycle_idx" ON "model_definitions" ("provider_id", "lifecycle_status", "id");
--> statement-breakpoint
CREATE TABLE "model_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"economy_model_definition_id" text NOT NULL,
	"balanced_model_definition_id" text NOT NULL,
	"best_model_definition_id" text NOT NULL,
	"updated_by_user_id" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_policies_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE restrict,
	CONSTRAINT "model_policies_economy_model_fk" FOREIGN KEY ("economy_model_definition_id") REFERENCES "model_definitions"("id") ON DELETE restrict,
	CONSTRAINT "model_policies_balanced_model_fk" FOREIGN KEY ("balanced_model_definition_id") REFERENCES "model_definitions"("id") ON DELETE restrict,
	CONSTRAINT "model_policies_best_model_fk" FOREIGN KEY ("best_model_definition_id") REFERENCES "model_definitions"("id") ON DELETE restrict,
	CONSTRAINT "model_policies_updated_by_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE restrict,
	CONSTRAINT "model_policies_row_version_check" CHECK ("model_policies"."row_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "model_policies_organization_uidx" ON "model_policies" ("organization_id");
--> statement-breakpoint
INSERT INTO "model_providers" ("id", "code", "display_name", "lifecycle_status", "execution_status", "data_policy_status", "allowed_regions") VALUES
	('MPROV-LOCAL-FIXTURE', 'LOCAL_FIXTURE', 'Axiom local fixture', 'LOCAL_ONLY', 'ENABLED', 'NO_EXTERNAL_TRANSFER', ARRAY['LOCAL']),
	('MPROV-OPENAI', 'OPENAI', 'OpenAI', 'CANDIDATE', 'DISABLED', 'REQUIRES_REVIEW', ARRAY[]::text[]),
	('MPROV-GROQ', 'GROQ', 'Groq', 'CANDIDATE', 'DISABLED', 'REQUIRES_REVIEW', ARRAY[]::text[]);
--> statement-breakpoint
INSERT INTO "model_definitions" ("id", "provider_id", "immutable_model_id", "display_name", "lifecycle_status", "execution_status", "capabilities", "pricing", "data_policy_status", "allowed_regions", "evaluation_status", "evaluation_scores") VALUES
	('MODEL-AXIOM-STRUCTURED-FIXTURE-V1', 'MPROV-LOCAL-FIXTURE', 'axiom-structured-fixture-v1', 'Axiom deterministic structured fixture', 'LOCAL_ONLY', 'ENABLED', '{"structuredOutput":true,"tools":false,"vision":false}'::jsonb, '{"status":"NOT_APPLICABLE"}'::jsonb, 'NO_EXTERNAL_TRANSFER', ARRAY['LOCAL'], 'LOCAL_FIXTURE_ONLY', '{}'::jsonb);
