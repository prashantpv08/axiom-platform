CREATE TABLE "work_item_generations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"source_graph_version" integer NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"content_hash" text NOT NULL,
	"schema_version" text NOT NULL,
	"evaluator_version" text NOT NULL,
	"prompt_version" text NOT NULL,
	"workflow_version" text NOT NULL,
	"quality_report" jsonb NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_item_generations_status_check" CHECK ("status" in ('DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'SUPERSEDED')),
	CONSTRAINT "work_item_generations_hash_check" CHECK ("content_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "work_items" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"type" text NOT NULL,
	"parent_id" text,
	"current_version" integer NOT NULL,
	"review_status" text DEFAULT 'DRAFT' NOT NULL,
	"source_graph_version" integer NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_items_type_check" CHECK ("type" in ('INITIATIVE', 'EPIC', 'STORY', 'TASK', 'DEFECT')),
	CONSTRAINT "work_items_review_status_check" CHECK ("review_status" in ('DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'SUPERSEDED')),
	CONSTRAINT "work_items_version_check" CHECK ("current_version" > 0 and "row_version" > 0 and "source_graph_version" > 0)
);
--> statement-breakpoint
CREATE TABLE "work_item_versions" (
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"work_item_id" text NOT NULL,
	"version" integer NOT NULL,
	"generation_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"content_hash" text NOT NULL,
	"created_by_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_item_versions_pk" PRIMARY KEY("work_item_id","version"),
	CONSTRAINT "work_item_versions_version_check" CHECK ("version" > 0),
	CONSTRAINT "work_item_versions_hash_check" CHECK ("content_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "work_item_generation_items" (
	"generation_id" text NOT NULL,
	"work_item_id" text NOT NULL,
	"work_item_version" integer NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "work_item_generation_items_pk" PRIMARY KEY("generation_id","work_item_id"),
	CONSTRAINT "work_item_generation_items_position_check" CHECK ("position" >= 0 and "work_item_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "work_item_generations" ADD CONSTRAINT "work_item_generations_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "projects"("organization_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "work_item_generations" ADD CONSTRAINT "work_item_generations_graph_fk" FOREIGN KEY ("organization_id","project_id","source_graph_version") REFERENCES "project_graphs"("organization_id","project_id","graph_version") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "work_item_generations" ADD CONSTRAINT "work_item_generations_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "projects"("organization_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "work_items" ADD CONSTRAINT "work_items_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "work_items"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "work_item_versions" ADD CONSTRAINT "work_item_versions_work_item_fk" FOREIGN KEY ("work_item_id") REFERENCES "work_items"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "work_item_versions" ADD CONSTRAINT "work_item_versions_generation_fk" FOREIGN KEY ("generation_id") REFERENCES "work_item_generations"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "work_item_versions" ADD CONSTRAINT "work_item_versions_created_by_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "work_item_generation_items" ADD CONSTRAINT "work_item_generation_items_generation_fk" FOREIGN KEY ("generation_id") REFERENCES "work_item_generations"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "work_item_generation_items" ADD CONSTRAINT "work_item_generation_items_version_fk" FOREIGN KEY ("work_item_id","work_item_version") REFERENCES "work_item_versions"("work_item_id","version") ON DELETE restrict;
--> statement-breakpoint
CREATE INDEX "work_item_generations_project_created_idx" ON "work_item_generations" ("organization_id","project_id","created_at","id");
--> statement-breakpoint
CREATE INDEX "work_items_project_updated_idx" ON "work_items" ("organization_id","project_id","updated_at","id");
--> statement-breakpoint
CREATE INDEX "work_item_versions_generation_idx" ON "work_item_versions" ("generation_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "work_item_generation_items_position_uidx" ON "work_item_generation_items" ("generation_id","position");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION axiom_prevent_work_item_version_update() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'work item versions are immutable'; END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER work_item_versions_immutable BEFORE UPDATE ON work_item_versions FOR EACH ROW EXECUTE FUNCTION axiom_prevent_work_item_version_update();
