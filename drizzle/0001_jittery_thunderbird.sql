ALTER TABLE "project_documents" DROP CONSTRAINT "project_documents_pkey";--> statement-breakpoint
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_pk" PRIMARY KEY("id","version");
