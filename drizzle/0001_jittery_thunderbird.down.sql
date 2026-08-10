DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM project_documents
		GROUP BY id
		HAVING count(*) > 1
	) THEN
		RAISE EXCEPTION 'remove or retain only one version per project document before rolling back composite document identities';
	END IF;
END;
$$;
ALTER TABLE "project_documents" DROP CONSTRAINT "project_documents_pk";--> statement-breakpoint
ALTER TABLE "project_documents" ADD CONSTRAINT "project_documents_pkey" PRIMARY KEY("id");
