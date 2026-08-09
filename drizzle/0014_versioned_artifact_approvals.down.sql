ALTER TABLE "project_documents" DROP CONSTRAINT IF EXISTS "project_documents_graph_fk";--> statement-breakpoint
ALTER TABLE "document_approvals" DROP CONSTRAINT IF EXISTS "document_approvals_graph_fk";--> statement-breakpoint
DROP INDEX IF EXISTS "document_approvals_project_graph_approved_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "document_approvals_project_uidx" ON "document_approvals" USING btree ("organization_id","project_id");
