DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM organization_invitations) THEN
		RAISE EXCEPTION 'remove organization invitations before rolling back invitation governance';
	END IF;
END;
$$;
DROP TABLE "organization_invitations";
ALTER TABLE "memberships" DROP CONSTRAINT "memberships_row_version_check";
ALTER TABLE "memberships" DROP COLUMN "row_version";
