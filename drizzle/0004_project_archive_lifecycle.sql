ALTER TABLE "projects" DROP CONSTRAINT "projects_status_check";
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "archived_from_status" text;
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "archived_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_status_check" CHECK ("projects"."status" in ('DRAFT', 'SOURCES_READY', 'ANALYZED', 'NEEDS_CLARIFICATION', 'DOCUMENTED', 'DOCUMENTS_APPROVED', 'DESIGN_READY', 'ARB_APPROVED', 'HLD_READY', 'PUBLISHED', 'BACKLOG_READY', 'ARCHIVED'));
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_archived_from_status_check" CHECK ("projects"."archived_from_status" is null or "projects"."archived_from_status" in ('DRAFT', 'SOURCES_READY', 'ANALYZED', 'NEEDS_CLARIFICATION', 'DOCUMENTED', 'DOCUMENTS_APPROVED', 'DESIGN_READY', 'ARB_APPROVED', 'HLD_READY', 'PUBLISHED', 'BACKLOG_READY'));
--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_archive_state_check" CHECK (("projects"."status" = 'ARCHIVED' and "projects"."archived_from_status" is not null and "projects"."archived_at" is not null) or ("projects"."status" <> 'ARCHIVED' and "projects"."archived_from_status" is null and "projects"."archived_at" is null));
