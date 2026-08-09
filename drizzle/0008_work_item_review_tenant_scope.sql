CREATE UNIQUE INDEX "work_item_generations_scope_id_uidx" ON "work_item_generations" ("organization_id","project_id","id");
--> statement-breakpoint
ALTER TABLE "work_item_reviews" DROP CONSTRAINT "work_item_reviews_generation_fk";
--> statement-breakpoint
ALTER TABLE "work_item_reviews" ADD CONSTRAINT "work_item_reviews_generation_scope_fk" FOREIGN KEY ("organization_id","project_id","generation_id") REFERENCES "work_item_generations"("organization_id","project_id","id") ON DELETE restrict;
