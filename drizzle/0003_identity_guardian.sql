CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_canonical_check" CHECK ("users"."email" = lower("users"."email")),
	CONSTRAINT "users_status_check" CHECK ("users"."status" in ('ACTIVE', 'DISABLED', 'DELETED'))
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_pk" PRIMARY KEY("organization_id", "user_id"),
	CONSTRAINT "memberships_role_check" CHECK ("memberships"."role" in ('OWNER', 'ADMINISTRATOR', 'PRODUCT_ANALYST', 'ARCHITECT', 'DEVELOPER', 'REVIEWER', 'VIEWER')),
	CONSTRAINT "memberships_status_check" CHECK ("memberships"."status" in ('ACTIVE', 'INVITED', 'REVOKED'))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_check" CHECK ("sessions"."token_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "sessions_status_check" CHECK ("sessions"."status" in ('ACTIVE', 'REVOKED', 'EXPIRED'))
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"actor_user_id" text,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"request_id" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uidx" ON "users" USING btree ("email");
--> statement-breakpoint
CREATE INDEX "memberships_user_status_idx" ON "memberships" USING btree ("user_id", "status");
--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_uidx" ON "sessions" USING btree ("token_hash");
--> statement-breakpoint
CREATE INDEX "sessions_user_status_idx" ON "sessions" USING btree ("user_id", "status");
--> statement-breakpoint
CREATE INDEX "sessions_expires_at_idx" ON "sessions" USING btree ("expires_at");
--> statement-breakpoint
CREATE INDEX "audit_events_organization_occurred_idx" ON "audit_events" USING btree ("organization_id", "occurred_at", "id");
--> statement-breakpoint
CREATE INDEX "audit_events_actor_occurred_idx" ON "audit_events" USING btree ("actor_user_id", "occurred_at");
--> statement-breakpoint
CREATE INDEX "audit_events_request_idx" ON "audit_events" USING btree ("request_id");
--> statement-breakpoint
CREATE FUNCTION axiom_prevent_audit_event_mutation() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'audit events are immutable' USING ERRCODE = '55000';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER audit_events_immutable
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION axiom_prevent_audit_event_mutation();
