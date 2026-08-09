ALTER TABLE "subscriptions" ADD COLUMN "provider_updated_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "provider_event_id" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_provider_external_uidx" ON "subscriptions" ("provider", "external_subscription_id") WHERE "provider" is not null and "external_subscription_id" is not null;
--> statement-breakpoint
CREATE TABLE "subscription_webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"provider" text NOT NULL,
	"external_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload_hash" text NOT NULL,
	"normalized_payload" jsonb NOT NULL,
	"signature_timestamp" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'RECEIVED' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"last_error_code" text,
	"response_payload" jsonb,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscription_webhook_events_hash_check" CHECK ("subscription_webhook_events"."payload_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "subscription_webhook_events_status_check" CHECK ("subscription_webhook_events"."status" in ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED')),
	CONSTRAINT "subscription_webhook_events_attempt_check" CHECK ("subscription_webhook_events"."attempt_count" >= 0),
	CONSTRAINT "subscription_webhook_events_state_check" CHECK (("subscription_webhook_events"."status" = 'RECEIVED' and "subscription_webhook_events"."processed_at" is null and "subscription_webhook_events"."last_error_code" is null and "subscription_webhook_events"."response_payload" is null) or ("subscription_webhook_events"."status" in ('PROCESSED', 'IGNORED') and "subscription_webhook_events"."processed_at" is not null and "subscription_webhook_events"."last_error_code" is null and "subscription_webhook_events"."response_payload" is not null) or ("subscription_webhook_events"."status" = 'FAILED' and "subscription_webhook_events"."processed_at" is not null and "subscription_webhook_events"."last_error_code" is not null and "subscription_webhook_events"."response_payload" is null))
);
--> statement-breakpoint
ALTER TABLE "subscription_webhook_events" ADD CONSTRAINT "subscription_webhook_events_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE restrict;
--> statement-breakpoint
CREATE UNIQUE INDEX "subscription_webhook_events_provider_event_uidx" ON "subscription_webhook_events" ("provider", "external_event_id");
--> statement-breakpoint
CREATE INDEX "subscription_webhook_events_organization_created_idx" ON "subscription_webhook_events" ("organization_id", "created_at", "id");
