DROP TABLE IF EXISTS "analysis_runs";--> statement-breakpoint
DROP INDEX IF EXISTS "project_sources_project_created_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "project_sources_project_key_version_uidx";--> statement-breakpoint
ALTER TABLE "project_sources" DROP CONSTRAINT IF EXISTS "project_sources_validation_status_check";--> statement-breakpoint
ALTER TABLE "project_sources" DROP CONSTRAINT IF EXISTS "project_sources_version_check";--> statement-breakpoint
ALTER TABLE "project_sources" DROP CONSTRAINT IF EXISTS "project_sources_uploaded_by_fk";--> statement-breakpoint
ALTER TABLE "project_sources" DROP COLUMN IF EXISTS "extracted_at";--> statement-breakpoint
ALTER TABLE "project_sources" DROP COLUMN IF EXISTS "validator";--> statement-breakpoint
ALTER TABLE "project_sources" DROP COLUMN IF EXISTS "validation_status";--> statement-breakpoint
ALTER TABLE "project_sources" DROP COLUMN IF EXISTS "uploaded_by_user_id";--> statement-breakpoint
ALTER TABLE "project_sources" DROP COLUMN IF EXISTS "version";--> statement-breakpoint
ALTER TABLE "project_sources" DROP COLUMN IF EXISTS "source_key";
