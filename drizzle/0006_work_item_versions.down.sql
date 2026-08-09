DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM work_item_generations) THEN
		RAISE EXCEPTION 'remove work item generations through the retention workflow before rollback';
	END IF;
END;
$$;
DROP TRIGGER IF EXISTS work_item_versions_immutable ON work_item_versions;
DROP FUNCTION IF EXISTS axiom_prevent_work_item_version_update();
DROP TABLE "work_item_generation_items";
DROP TABLE "work_item_versions";
DROP TABLE "work_items";
DROP TABLE "work_item_generations";
