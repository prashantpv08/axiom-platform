DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM projects WHERE status = 'ARCHIVED') THEN
		RAISE EXCEPTION 'restore archived projects before rolling back project archive lifecycle';
	END IF;
END;
$$;
ALTER TABLE "projects" DROP CONSTRAINT "projects_archive_state_check";
ALTER TABLE "projects" DROP CONSTRAINT "projects_archived_from_status_check";
ALTER TABLE "projects" DROP COLUMN "archived_at";
ALTER TABLE "projects" DROP COLUMN "archived_from_status";
ALTER TABLE "projects" DROP CONSTRAINT "projects_status_check";
ALTER TABLE "projects" ADD CONSTRAINT "projects_status_check" CHECK ("projects"."status" in ('DRAFT', 'SOURCES_READY', 'ANALYZED', 'NEEDS_CLARIFICATION', 'DOCUMENTED', 'DOCUMENTS_APPROVED', 'DESIGN_READY', 'ARB_APPROVED', 'HLD_READY', 'PUBLISHED', 'BACKLOG_READY'));
