CREATE TABLE "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"currency" text NOT NULL,
	"billing_period_credit_units" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_status_check" CHECK ("plans"."status" in ('ACTIVE', 'RETIRED')),
	CONSTRAINT "plans_currency_check" CHECK ("plans"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "plans_credit_units_check" CHECK ("plans"."billing_period_credit_units" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "plans_code_uidx" ON "plans" ("code");
--> statement-breakpoint
CREATE TABLE "plan_entitlements" (
	"plan_id" text NOT NULL,
	"key" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"integer_limit" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_entitlements_pk" PRIMARY KEY("plan_id", "key"),
	CONSTRAINT "plan_entitlements_key_check" CHECK ("plan_entitlements"."key" in ('AI_USAGE', 'MAX_CREDITS_PER_REQUEST')),
	CONSTRAINT "plan_entitlements_integer_limit_check" CHECK ("plan_entitlements"."integer_limit" is null or "plan_entitlements"."integer_limit" >= 0)
);
--> statement-breakpoint
ALTER TABLE "plan_entitlements" ADD CONSTRAINT "plan_entitlements_plan_fk" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE restrict;
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"status" text NOT NULL,
	"billing_period_start" timestamp with time zone NOT NULL,
	"billing_period_end" timestamp with time zone NOT NULL,
	"provider" text,
	"external_customer_id" text,
	"external_subscription_id" text,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_status_check" CHECK ("subscriptions"."status" in ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED')),
	CONSTRAINT "subscriptions_period_check" CHECK ("subscriptions"."billing_period_end" > "subscriptions"."billing_period_start"),
	CONSTRAINT "subscriptions_row_version_check" CHECK ("subscriptions"."row_version" > 0),
	CONSTRAINT "subscriptions_provider_fields_check" CHECK (("subscriptions"."provider" is null and "subscriptions"."external_customer_id" is null and "subscriptions"."external_subscription_id" is null) or ("subscriptions"."provider" is not null and "subscriptions"."external_customer_id" is not null and "subscriptions"."external_subscription_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_fk" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_fk" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE restrict;
--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_organization_id_uidx" ON "subscriptions" ("organization_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_current_organization_uidx" ON "subscriptions" ("organization_id") WHERE "status" in ('TRIALING', 'ACTIVE', 'PAST_DUE');
--> statement-breakpoint
CREATE TABLE "credit_balances" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"subscription_id" text NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"allocated_credit_units" integer NOT NULL,
	"reserved_credit_units" integer DEFAULT 0 NOT NULL,
	"consumed_credit_units" integer DEFAULT 0 NOT NULL,
	"alert_threshold_percent" integer DEFAULT 80 NOT NULL,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credit_balances_period_check" CHECK ("credit_balances"."period_end" > "credit_balances"."period_start"),
	CONSTRAINT "credit_balances_units_check" CHECK ("credit_balances"."allocated_credit_units" >= 0 and "credit_balances"."reserved_credit_units" >= 0 and "credit_balances"."consumed_credit_units" >= 0 and "credit_balances"."reserved_credit_units" + "credit_balances"."consumed_credit_units" <= "credit_balances"."allocated_credit_units"),
	CONSTRAINT "credit_balances_alert_check" CHECK ("credit_balances"."alert_threshold_percent" between 1 and 100),
	CONSTRAINT "credit_balances_row_version_check" CHECK ("credit_balances"."row_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "credit_balances" ADD CONSTRAINT "credit_balances_subscription_scope_fk" FOREIGN KEY ("organization_id", "subscription_id") REFERENCES "subscriptions"("organization_id", "id") ON DELETE restrict;
--> statement-breakpoint
CREATE UNIQUE INDEX "credit_balances_organization_id_uidx" ON "credit_balances" ("organization_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX "credit_balances_subscription_period_uidx" ON "credit_balances" ("subscription_id", "period_start", "period_end");
--> statement-breakpoint
CREATE TABLE "usage_reservations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"credit_balance_id" text NOT NULL,
	"project_id" text,
	"user_id" text NOT NULL,
	"workflow" text NOT NULL,
	"workflow_version" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"generation_id" text,
	"run_id" text NOT NULL,
	"entitlement_key" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"reconciliation_hash" text,
	"estimated_credit_units" integer NOT NULL,
	"actual_credit_units" integer,
	"status" text DEFAULT 'RESERVED' NOT NULL,
	"outcome" text,
	"expires_at" timestamp with time zone NOT NULL,
	"reconciled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_reservations_entitlement_check" CHECK ("usage_reservations"."entitlement_key" = 'AI_USAGE'),
	CONSTRAINT "usage_reservations_hash_check" CHECK ("usage_reservations"."request_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "usage_reservations_reconciliation_hash_check" CHECK ("usage_reservations"."reconciliation_hash" is null or "usage_reservations"."reconciliation_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "usage_reservations_estimate_check" CHECK ("usage_reservations"."estimated_credit_units" > 0),
	CONSTRAINT "usage_reservations_actual_check" CHECK ("usage_reservations"."actual_credit_units" is null or ("usage_reservations"."actual_credit_units" >= 0 and "usage_reservations"."actual_credit_units" <= "usage_reservations"."estimated_credit_units")),
	CONSTRAINT "usage_reservations_status_check" CHECK ("usage_reservations"."status" in ('RESERVED', 'RECONCILED')),
	CONSTRAINT "usage_reservations_outcome_check" CHECK ("usage_reservations"."outcome" is null or "usage_reservations"."outcome" in ('SUCCEEDED', 'FAILED', 'CANCELLED', 'CACHED')),
	CONSTRAINT "usage_reservations_state_check" CHECK (("usage_reservations"."status" = 'RESERVED' and "usage_reservations"."actual_credit_units" is null and "usage_reservations"."outcome" is null and "usage_reservations"."reconciliation_hash" is null and "usage_reservations"."reconciled_at" is null) or ("usage_reservations"."status" = 'RECONCILED' and "usage_reservations"."actual_credit_units" is not null and "usage_reservations"."outcome" is not null and "usage_reservations"."reconciliation_hash" is not null and "usage_reservations"."reconciled_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD CONSTRAINT "usage_reservations_balance_scope_fk" FOREIGN KEY ("organization_id", "credit_balance_id") REFERENCES "credit_balances"("organization_id", "id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "usage_reservations" ADD CONSTRAINT "usage_reservations_user_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE restrict;
--> statement-breakpoint
CREATE UNIQUE INDEX "usage_reservations_organization_id_uidx" ON "usage_reservations" ("organization_id", "id");
--> statement-breakpoint
CREATE UNIQUE INDEX "usage_reservations_idempotency_uidx" ON "usage_reservations" ("organization_id", "idempotency_key");
--> statement-breakpoint
CREATE INDEX "usage_reservations_balance_status_idx" ON "usage_reservations" ("credit_balance_id", "status", "expires_at");
--> statement-breakpoint
CREATE TABLE "usage_ledger_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"credit_balance_id" text NOT NULL,
	"reservation_id" text NOT NULL,
	"event_type" text NOT NULL,
	"reserved_credit_units" integer DEFAULT 0 NOT NULL,
	"charged_credit_units" integer DEFAULT 0 NOT NULL,
	"released_credit_units" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"tool_charge_micros" integer DEFAULT 0 NOT NULL,
	"provider_cost_micros" integer DEFAULT 0 NOT NULL,
	"currency" text NOT NULL,
	"outcome" text,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"fallback_used" boolean DEFAULT false NOT NULL,
	"cache_hit" boolean DEFAULT false NOT NULL,
	"project_id" text,
	"user_id" text NOT NULL,
	"workflow" text NOT NULL,
	"workflow_version" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"generation_id" text,
	"run_id" text NOT NULL,
	"request_id" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_ledger_event_check" CHECK ("usage_ledger_entries"."event_type" in ('RESERVATION', 'RECONCILIATION')),
	CONSTRAINT "usage_ledger_units_check" CHECK ("usage_ledger_entries"."reserved_credit_units" >= 0 and "usage_ledger_entries"."charged_credit_units" >= 0 and "usage_ledger_entries"."released_credit_units" >= 0),
	CONSTRAINT "usage_ledger_measurements_check" CHECK ("usage_ledger_entries"."input_tokens" >= 0 and "usage_ledger_entries"."output_tokens" >= 0 and "usage_ledger_entries"."tool_charge_micros" >= 0 and "usage_ledger_entries"."provider_cost_micros" >= 0 and "usage_ledger_entries"."retry_count" >= 0),
	CONSTRAINT "usage_ledger_currency_check" CHECK ("usage_ledger_entries"."currency" ~ '^[A-Z]{3}$'),
	CONSTRAINT "usage_ledger_outcome_check" CHECK ("usage_ledger_entries"."outcome" is null or "usage_ledger_entries"."outcome" in ('SUCCEEDED', 'FAILED', 'CANCELLED', 'CACHED')),
	CONSTRAINT "usage_ledger_event_shape_check" CHECK (("usage_ledger_entries"."event_type" = 'RESERVATION' and "usage_ledger_entries"."reserved_credit_units" > 0 and "usage_ledger_entries"."charged_credit_units" = 0 and "usage_ledger_entries"."released_credit_units" = 0 and "usage_ledger_entries"."outcome" is null) or ("usage_ledger_entries"."event_type" = 'RECONCILIATION' and "usage_ledger_entries"."reserved_credit_units" = 0 and "usage_ledger_entries"."outcome" is not null))
);
--> statement-breakpoint
ALTER TABLE "usage_ledger_entries" ADD CONSTRAINT "usage_ledger_balance_scope_fk" FOREIGN KEY ("organization_id", "credit_balance_id") REFERENCES "credit_balances"("organization_id", "id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "usage_ledger_entries" ADD CONSTRAINT "usage_ledger_reservation_scope_fk" FOREIGN KEY ("organization_id", "reservation_id") REFERENCES "usage_reservations"("organization_id", "id") ON DELETE restrict;
--> statement-breakpoint
ALTER TABLE "usage_ledger_entries" ADD CONSTRAINT "usage_ledger_user_fk" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE restrict;
--> statement-breakpoint
CREATE INDEX "usage_ledger_organization_occurred_idx" ON "usage_ledger_entries" ("organization_id", "occurred_at", "id");
--> statement-breakpoint
CREATE INDEX "usage_ledger_project_occurred_idx" ON "usage_ledger_entries" ("organization_id", "project_id", "occurred_at");
--> statement-breakpoint
CREATE FUNCTION axiom_prevent_usage_ledger_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'usage ledger entries are immutable' USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER usage_ledger_entries_immutable
BEFORE UPDATE OR DELETE ON usage_ledger_entries
FOR EACH ROW EXECUTE FUNCTION axiom_prevent_usage_ledger_mutation();
--> statement-breakpoint
INSERT INTO "plans" ("id", "code", "name", "status", "currency", "billing_period_credit_units")
VALUES ('PLAN-LOCAL-DEVELOPMENT', 'LOCAL_DEVELOPMENT', 'Local development', 'ACTIVE', 'USD', 100000);
--> statement-breakpoint
INSERT INTO "plan_entitlements" ("plan_id", "key", "enabled", "integer_limit") VALUES
	('PLAN-LOCAL-DEVELOPMENT', 'AI_USAGE', true, null),
	('PLAN-LOCAL-DEVELOPMENT', 'MAX_CREDITS_PER_REQUEST', true, 10000);
