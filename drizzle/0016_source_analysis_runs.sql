ALTER TABLE "project_sources" ADD COLUMN "source_key" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_sources" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "project_sources" ADD COLUMN "uploaded_by_user_id" text;--> statement-breakpoint
ALTER TABLE "project_sources" ADD COLUMN "validation_status" text DEFAULT 'LEGACY_NOT_VERIFIED' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_sources" ADD COLUMN "validator" text DEFAULT 'legacy-import' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_sources" ADD COLUMN "extracted_at" timestamp with time zone;--> statement-breakpoint
UPDATE "project_sources" SET "source_key" = md5("project_id" || ':' || "name" || ':' || "id") || md5("id" || ':' || "name"), "version" = 1 WHERE "source_key" = 'legacy';--> statement-breakpoint
ALTER TABLE "project_sources" ADD CONSTRAINT "project_sources_uploaded_by_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_sources" ADD CONSTRAINT "project_sources_version_check" CHECK ("version" > 0);--> statement-breakpoint
ALTER TABLE "project_sources" ADD CONSTRAINT "project_sources_validation_status_check" CHECK ("validation_status" in ('VALIDATED', 'LEGACY_NOT_VERIFIED'));--> statement-breakpoint
CREATE UNIQUE INDEX "project_sources_project_key_version_uidx" ON "project_sources" USING btree ("organization_id", "project_id", "source_key", "version") WHERE "source_key" <> 'legacy';--> statement-breakpoint
CREATE INDEX "project_sources_project_created_idx" ON "project_sources" USING btree ("organization_id", "project_id", "created_at", "id");--> statement-breakpoint
CREATE TABLE "analysis_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"request_id" text NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"analyzer" text NOT NULL,
	"source_snapshot_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"locked_by" text,
	"locked_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"graph_version" integer,
	"error_code" text,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analysis_runs_status_check" CHECK ("status" in ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
	CONSTRAINT "analysis_runs_attempts_check" CHECK ("attempts" >= 0),
	CONSTRAINT "analysis_runs_snapshot_hash_check" CHECK ("source_snapshot_hash" ~ '^[a-f0-9]{64}$')
);--> statement-breakpoint
ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_project_fk" FOREIGN KEY ("organization_id", "project_id") REFERENCES "public"."projects"("organization_id", "id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_runs" ADD CONSTRAINT "analysis_runs_requester_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_runs_scope_id_uidx" ON "analysis_runs" USING btree ("organization_id", "project_id", "id");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_runs_one_active_per_project_uidx" ON "analysis_runs" USING btree ("organization_id", "project_id") WHERE "status" in ('QUEUED', 'RUNNING');--> statement-breakpoint
CREATE INDEX "analysis_runs_queue_idx" ON "analysis_runs" USING btree ("status", "created_at", "id");--> statement-breakpoint
CREATE INDEX "analysis_runs_project_created_idx" ON "analysis_runs" USING btree ("organization_id", "project_id", "created_at", "id");
