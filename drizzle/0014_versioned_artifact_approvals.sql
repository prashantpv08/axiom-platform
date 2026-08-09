DROP INDEX "document_approvals_project_uidx";--> statement-breakpoint
CREATE INDEX "document_approvals_project_graph_approved_idx" ON "document_approvals" USING btree ("organization_id","project_id","graph_version","approved_at");--> statement-breakpoint
ALTER TABLE "document_approvals" ADD CONSTRAINT "document_approvals_graph_fk" FOREIGN KEY ("organization_id","project_id","graph_version") REFERENCES "public"."project_graphs"("organization_id","project_id","graph_version") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- Prototype databases may contain immutable document history for graph snapshots that
-- predate graph-history retention. NOT VALID preserves those rows while PostgreSQL
-- still enforces this foreign key for every new or changed document.
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_graph_fk" FOREIGN KEY ("organization_id","project_id","source_graph_version") REFERENCES "public"."project_graphs"("organization_id","project_id","graph_version") ON DELETE restrict ON UPDATE no action NOT VALID;
