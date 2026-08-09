ALTER TABLE "work_item_reviews" DROP CONSTRAINT "work_item_reviews_generation_scope_fk";
ALTER TABLE "work_item_reviews" ADD CONSTRAINT "work_item_reviews_generation_fk" FOREIGN KEY ("generation_id") REFERENCES "work_item_generations"("id") ON DELETE restrict;
DROP INDEX "work_item_generations_scope_id_uidx";
