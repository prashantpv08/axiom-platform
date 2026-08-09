ALTER TABLE "plan_entitlements" DROP CONSTRAINT "plan_entitlements_key_check";
--> statement-breakpoint
ALTER TABLE "plan_entitlements" ADD CONSTRAINT "plan_entitlements_key_check" CHECK ("plan_entitlements"."key" in ('AI_USAGE', 'MAX_CREDITS_PER_REQUEST', 'MAX_DAILY_CREDITS', 'MAX_USER_DAILY_CREDITS', 'MAX_PROJECT_DAILY_CREDITS'));
--> statement-breakpoint
INSERT INTO "plan_entitlements" ("plan_id", "key", "enabled", "integer_limit") VALUES
	('PLAN-LOCAL-DEVELOPMENT', 'MAX_DAILY_CREDITS', true, 50000),
	('PLAN-LOCAL-DEVELOPMENT', 'MAX_USER_DAILY_CREDITS', true, 25000),
	('PLAN-LOCAL-DEVELOPMENT', 'MAX_PROJECT_DAILY_CREDITS', true, 40000);
--> statement-breakpoint
CREATE TABLE "budget_policies" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"daily_credit_limit" integer NOT NULL,
	"user_daily_credit_limit" integer NOT NULL,
	"project_daily_credit_limit" integer NOT NULL,
	"alert_threshold_percent" integer DEFAULT 80 NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_policies_limits_check" CHECK ("budget_policies"."daily_credit_limit" >= 0 and "budget_policies"."user_daily_credit_limit" >= 0 and "budget_policies"."project_daily_credit_limit" >= 0 and "budget_policies"."user_daily_credit_limit" <= "budget_policies"."daily_credit_limit" and "budget_policies"."project_daily_credit_limit" <= "budget_policies"."daily_credit_limit"),
	CONSTRAINT "budget_policies_alert_check" CHECK ("budget_policies"."alert_threshold_percent" between 1 and 100),
	CONSTRAINT "budget_policies_row_version_check" CHECK ("budget_policies"."row_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "budget_policies" ADD CONSTRAINT "budget_policies_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE restrict;
--> statement-breakpoint
CREATE UNIQUE INDEX "budget_policies_organization_uidx" ON "budget_policies" ("organization_id");
--> statement-breakpoint
INSERT INTO "budget_policies" (
	"id", "organization_id", "daily_credit_limit", "user_daily_credit_limit", "project_daily_credit_limit", "alert_threshold_percent"
)
SELECT
	'BPOL-' || md5(s."organization_id"),
	s."organization_id",
	least(p."billing_period_credit_units", max(e."integer_limit") FILTER (WHERE e."key" = 'MAX_DAILY_CREDITS')),
	least(p."billing_period_credit_units", max(e."integer_limit") FILTER (WHERE e."key" = 'MAX_USER_DAILY_CREDITS')),
	least(p."billing_period_credit_units", max(e."integer_limit") FILTER (WHERE e."key" = 'MAX_PROJECT_DAILY_CREDITS')),
	max(cb."alert_threshold_percent")
FROM "subscriptions" s
JOIN "plans" p ON p."id" = s."plan_id"
JOIN "plan_entitlements" e ON e."plan_id" = p."id" AND e."enabled" = true
JOIN "credit_balances" cb ON cb."organization_id" = s."organization_id" AND cb."subscription_id" = s."id"
WHERE s."status" in ('TRIALING', 'ACTIVE', 'PAST_DUE')
GROUP BY s."organization_id", p."billing_period_credit_units"
HAVING count(*) FILTER (WHERE e."key" in ('MAX_DAILY_CREDITS', 'MAX_USER_DAILY_CREDITS', 'MAX_PROJECT_DAILY_CREDITS') AND e."integer_limit" is not null) = 3;
--> statement-breakpoint
ALTER TABLE "usage_reservations" DROP CONSTRAINT "usage_reservations_status_check";
--> statement-breakpoint
ALTER TABLE "usage_reservations" DROP CONSTRAINT "usage_reservations_state_check";
--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD CONSTRAINT "usage_reservations_status_check" CHECK ("usage_reservations"."status" in ('RESERVED', 'RECONCILED', 'EXPIRED'));
--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD CONSTRAINT "usage_reservations_state_check" CHECK (("usage_reservations"."status" = 'RESERVED' and "usage_reservations"."actual_credit_units" is null and "usage_reservations"."outcome" is null and "usage_reservations"."reconciliation_hash" is null and "usage_reservations"."reconciled_at" is null) or ("usage_reservations"."status" = 'RECONCILED' and "usage_reservations"."actual_credit_units" is not null and "usage_reservations"."outcome" is not null and "usage_reservations"."reconciliation_hash" is not null and "usage_reservations"."reconciled_at" is not null) or ("usage_reservations"."status" = 'EXPIRED' and "usage_reservations"."actual_credit_units" = 0 and "usage_reservations"."outcome" = 'CANCELLED' and "usage_reservations"."reconciliation_hash" is not null and "usage_reservations"."reconciled_at" is not null));
--> statement-breakpoint
ALTER TABLE "usage_ledger_entries" DROP CONSTRAINT "usage_ledger_event_check";
--> statement-breakpoint
ALTER TABLE "usage_ledger_entries" DROP CONSTRAINT "usage_ledger_event_shape_check";
--> statement-breakpoint
ALTER TABLE "usage_ledger_entries" ADD CONSTRAINT "usage_ledger_event_check" CHECK ("usage_ledger_entries"."event_type" in ('RESERVATION', 'RECONCILIATION', 'EXPIRATION'));
--> statement-breakpoint
ALTER TABLE "usage_ledger_entries" ADD CONSTRAINT "usage_ledger_event_shape_check" CHECK (("usage_ledger_entries"."event_type" = 'RESERVATION' and "usage_ledger_entries"."reserved_credit_units" > 0 and "usage_ledger_entries"."charged_credit_units" = 0 and "usage_ledger_entries"."released_credit_units" = 0 and "usage_ledger_entries"."outcome" is null) or ("usage_ledger_entries"."event_type" = 'RECONCILIATION' and "usage_ledger_entries"."reserved_credit_units" = 0 and "usage_ledger_entries"."outcome" is not null) or ("usage_ledger_entries"."event_type" = 'EXPIRATION' and "usage_ledger_entries"."reserved_credit_units" = 0 and "usage_ledger_entries"."charged_credit_units" = 0 and "usage_ledger_entries"."released_credit_units" > 0 and "usage_ledger_entries"."input_tokens" = 0 and "usage_ledger_entries"."output_tokens" = 0 and "usage_ledger_entries"."tool_charge_micros" = 0 and "usage_ledger_entries"."provider_cost_micros" = 0 and "usage_ledger_entries"."outcome" = 'CANCELLED'));
