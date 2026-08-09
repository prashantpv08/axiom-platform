DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM work_item_reviews) THEN
		RAISE EXCEPTION 'remove work item reviews through the retention workflow before rollback';
	END IF;
END;
$$;
DROP TRIGGER IF EXISTS work_item_generation_content_immutable ON work_item_generations;
DROP FUNCTION IF EXISTS axiom_guard_work_item_generation_content();
DROP TRIGGER IF EXISTS work_item_generation_items_immutable ON work_item_generation_items;
DROP TRIGGER IF EXISTS work_item_review_items_immutable ON work_item_review_items;
DROP TRIGGER IF EXISTS work_item_reviews_immutable ON work_item_reviews;
DROP FUNCTION IF EXISTS axiom_prevent_work_item_review_update();
DROP TABLE "work_item_review_items";
DROP TABLE "work_item_reviews";
