CREATE TABLE "work_item_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"generation_id" text NOT NULL,
	"decision" text NOT NULL,
	"reason_category" text NOT NULL,
	"comment" text NOT NULL,
	"generation_content_hash" text NOT NULL,
	"reviewed_content_hash" text NOT NULL,
	"quality_report" jsonb NOT NULL,
	"reviewed_by_user_id" text NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_item_reviews_decision_check" CHECK ("decision" in ('ACCEPT', 'ACCEPT_WITH_EDITS', 'REJECT')),
	CONSTRAINT "work_item_reviews_comment_check" CHECK (char_length("comment") between 10 and 2000),
	CONSTRAINT "work_item_reviews_generation_hash_check" CHECK ("generation_content_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "work_item_reviews_reviewed_hash_check" CHECK ("reviewed_content_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "work_item_review_items" (
	"review_id" text NOT NULL,
	"work_item_id" text NOT NULL,
	"work_item_version" integer NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "work_item_review_items_pk" PRIMARY KEY("review_id","work_item_id"),
	CONSTRAINT "work_item_review_items_position_check" CHECK ("position" >= 0 and "work_item_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "work_item_reviews" ADD CONSTRAINT "work_item_reviews_project_fk" FOREIGN KEY ("organization_id","project_id") REFERENCES "projects"("organization_id","id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "work_item_reviews" ADD CONSTRAINT "work_item_reviews_generation_fk" FOREIGN KEY ("generation_id") REFERENCES "work_item_generations"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "work_item_reviews" ADD CONSTRAINT "work_item_reviews_reviewed_by_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "work_item_review_items" ADD CONSTRAINT "work_item_review_items_review_fk" FOREIGN KEY ("review_id") REFERENCES "work_item_reviews"("id") ON DELETE cascade;
--> statement-breakpoint
ALTER TABLE "work_item_review_items" ADD CONSTRAINT "work_item_review_items_version_fk" FOREIGN KEY ("work_item_id","work_item_version") REFERENCES "work_item_versions"("work_item_id","version") ON DELETE restrict;
--> statement-breakpoint
CREATE UNIQUE INDEX "work_item_reviews_generation_uidx" ON "work_item_reviews" ("generation_id");
--> statement-breakpoint
CREATE INDEX "work_item_reviews_project_reviewed_idx" ON "work_item_reviews" ("organization_id","project_id","reviewed_at","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "work_item_review_items_position_uidx" ON "work_item_review_items" ("review_id","position");
--> statement-breakpoint
CREATE OR REPLACE FUNCTION axiom_prevent_work_item_review_update() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'work item reviews are immutable'; END; $$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER work_item_reviews_immutable BEFORE UPDATE ON work_item_reviews FOR EACH ROW EXECUTE FUNCTION axiom_prevent_work_item_review_update();
--> statement-breakpoint
CREATE TRIGGER work_item_review_items_immutable BEFORE UPDATE ON work_item_review_items FOR EACH ROW EXECUTE FUNCTION axiom_prevent_work_item_review_update();
--> statement-breakpoint
CREATE TRIGGER work_item_generation_items_immutable BEFORE UPDATE ON work_item_generation_items FOR EACH ROW EXECUTE FUNCTION axiom_prevent_work_item_review_update();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION axiom_guard_work_item_generation_content() RETURNS trigger AS $$
BEGIN
	IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
		OR NEW.project_id IS DISTINCT FROM OLD.project_id
		OR NEW.source_graph_version IS DISTINCT FROM OLD.source_graph_version
		OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
		OR NEW.schema_version IS DISTINCT FROM OLD.schema_version
		OR NEW.evaluator_version IS DISTINCT FROM OLD.evaluator_version
		OR NEW.prompt_version IS DISTINCT FROM OLD.prompt_version
		OR NEW.workflow_version IS DISTINCT FROM OLD.workflow_version
		OR NEW.quality_report IS DISTINCT FROM OLD.quality_report
		OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
		OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
		RAISE EXCEPTION 'work item generation content is immutable';
	END IF;
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER work_item_generation_content_immutable BEFORE UPDATE ON work_item_generations FOR EACH ROW EXECUTE FUNCTION axiom_guard_work_item_generation_content();
