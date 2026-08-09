CREATE TABLE "architecture_generations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"graph_version" integer NOT NULL,
	"version" integer NOT NULL,
	"content_hash" text NOT NULL,
	"compiler_version" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "architecture_generations_version_check" CHECK ("architecture_generations"."version" > 0 and "architecture_generations"."graph_version" > 0),
	CONSTRAINT "architecture_generations_hash_check" CHECK ("architecture_generations"."content_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "architecture_option_versions" (
	"generation_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"option_id" text NOT NULL,
	"position" integer NOT NULL,
	"content_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	CONSTRAINT "architecture_option_versions_pk" PRIMARY KEY("generation_id","option_id"),
	CONSTRAINT "architecture_option_versions_position_check" CHECK ("architecture_option_versions"."position" >= 0),
	CONSTRAINT "architecture_option_versions_hash_check" CHECK ("architecture_option_versions"."content_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "architecture_generations" ADD CONSTRAINT "architecture_generations_graph_fk" FOREIGN KEY ("organization_id","project_id","graph_version") REFERENCES "public"."project_graphs"("organization_id","project_id","graph_version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "architecture_generations" ADD CONSTRAINT "architecture_generations_creator_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "architecture_option_versions" ADD CONSTRAINT "architecture_option_versions_generation_fk" FOREIGN KEY ("generation_id") REFERENCES "public"."architecture_generations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "architecture_generations_project_version_uidx" ON "architecture_generations" USING btree ("organization_id","project_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "architecture_generations_scope_id_uidx" ON "architecture_generations" USING btree ("organization_id","project_id","id");--> statement-breakpoint
CREATE INDEX "architecture_generations_project_graph_created_idx" ON "architecture_generations" USING btree ("organization_id","project_id","graph_version","created_at","id");--> statement-breakpoint
CREATE INDEX "architecture_option_versions_scope_generation_idx" ON "architecture_option_versions" USING btree ("organization_id","project_id","generation_id","position");--> statement-breakpoint
ALTER TABLE "arb_decisions" ADD CONSTRAINT "arb_decisions_graph_fk" FOREIGN KEY ("organization_id","project_id","graph_version") REFERENCES "public"."project_graphs"("organization_id","project_id","graph_version") ON DELETE restrict ON UPDATE no action;
