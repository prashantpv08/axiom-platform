DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM budget_policies WHERE row_version > 1 OR updated_at <> created_at) THEN
		RAISE EXCEPTION 'Cannot roll back scoped budget controls after a policy was changed';
	END IF;
	IF EXISTS (SELECT 1 FROM usage_reservations WHERE status = 'EXPIRED') OR EXISTS (SELECT 1 FROM usage_ledger_entries WHERE event_type = 'EXPIRATION') THEN
		RAISE EXCEPTION 'Cannot roll back scoped budget controls after reservation expiration evidence exists';
	END IF;
END;
$$;

ALTER TABLE "usage_ledger_entries" DROP CONSTRAINT "usage_ledger_event_shape_check";
ALTER TABLE "usage_ledger_entries" DROP CONSTRAINT "usage_ledger_event_check";
ALTER TABLE "usage_ledger_entries" ADD CONSTRAINT "usage_ledger_event_check" CHECK ("usage_ledger_entries"."event_type" in ('RESERVATION', 'RECONCILIATION'));
ALTER TABLE "usage_ledger_entries" ADD CONSTRAINT "usage_ledger_event_shape_check" CHECK (("usage_ledger_entries"."event_type" = 'RESERVATION' and "usage_ledger_entries"."reserved_credit_units" > 0 and "usage_ledger_entries"."charged_credit_units" = 0 and "usage_ledger_entries"."released_credit_units" = 0 and "usage_ledger_entries"."outcome" is null) or ("usage_ledger_entries"."event_type" = 'RECONCILIATION' and "usage_ledger_entries"."reserved_credit_units" = 0 and "usage_ledger_entries"."outcome" is not null));
ALTER TABLE "usage_reservations" DROP CONSTRAINT "usage_reservations_state_check";
ALTER TABLE "usage_reservations" DROP CONSTRAINT "usage_reservations_status_check";
ALTER TABLE "usage_reservations" ADD CONSTRAINT "usage_reservations_status_check" CHECK ("usage_reservations"."status" in ('RESERVED', 'RECONCILED'));
ALTER TABLE "usage_reservations" ADD CONSTRAINT "usage_reservations_state_check" CHECK (("usage_reservations"."status" = 'RESERVED' and "usage_reservations"."actual_credit_units" is null and "usage_reservations"."outcome" is null and "usage_reservations"."reconciliation_hash" is null and "usage_reservations"."reconciled_at" is null) or ("usage_reservations"."status" = 'RECONCILED' and "usage_reservations"."actual_credit_units" is not null and "usage_reservations"."outcome" is not null and "usage_reservations"."reconciliation_hash" is not null and "usage_reservations"."reconciled_at" is not null));
DROP TABLE "budget_policies";
DELETE FROM "plan_entitlements" WHERE "key" in ('MAX_DAILY_CREDITS', 'MAX_USER_DAILY_CREDITS', 'MAX_PROJECT_DAILY_CREDITS');
ALTER TABLE "plan_entitlements" DROP CONSTRAINT "plan_entitlements_key_check";
ALTER TABLE "plan_entitlements" ADD CONSTRAINT "plan_entitlements_key_check" CHECK ("plan_entitlements"."key" in ('AI_USAGE', 'MAX_CREDITS_PER_REQUEST'));
