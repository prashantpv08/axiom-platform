DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM usage_reservations) THEN
		RAISE EXCEPTION 'Cannot roll back cost governance while usage reservations exist';
	END IF;
END;
$$;

DROP TRIGGER IF EXISTS usage_ledger_entries_immutable ON usage_ledger_entries;
DROP FUNCTION IF EXISTS axiom_prevent_usage_ledger_mutation();
DROP TABLE usage_ledger_entries;
DROP TABLE usage_reservations;
DROP TABLE credit_balances;
DROP TABLE subscriptions;
DROP TABLE plan_entitlements;
DROP TABLE plans;
