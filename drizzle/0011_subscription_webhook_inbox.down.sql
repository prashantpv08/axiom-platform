DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM subscription_webhook_events) THEN
		RAISE EXCEPTION 'Cannot roll back subscription webhook inbox after webhook evidence exists';
	END IF;
	IF EXISTS (SELECT 1 FROM subscriptions WHERE provider_updated_at is not null OR provider_event_id is not null) THEN
		RAISE EXCEPTION 'Cannot roll back subscription webhook inbox after a provider snapshot was applied';
	END IF;
END;
$$;

DROP TABLE "subscription_webhook_events";
DROP INDEX "subscriptions_provider_external_uidx";
ALTER TABLE "subscriptions" DROP COLUMN "provider_event_id";
ALTER TABLE "subscriptions" DROP COLUMN "provider_updated_at";
