ALTER TABLE "memberships" ADD COLUMN "row_version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_row_version_check" CHECK ("memberships"."row_version" > 0);
--> statement-breakpoint
CREATE TABLE "organization_invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by_user_id" text NOT NULL,
	"accepted_by_user_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"row_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_invitations_email_canonical_check" CHECK ("organization_invitations"."email" = lower("organization_invitations"."email")),
	CONSTRAINT "organization_invitations_role_check" CHECK ("organization_invitations"."role" in ('ADMINISTRATOR', 'PRODUCT_ANALYST', 'ARCHITECT', 'DEVELOPER', 'REVIEWER', 'VIEWER')),
	CONSTRAINT "organization_invitations_status_check" CHECK ("organization_invitations"."status" in ('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED')),
	CONSTRAINT "organization_invitations_token_hash_check" CHECK ("organization_invitations"."token_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "organization_invitations_row_version_check" CHECK ("organization_invitations"."row_version" > 0)
);
--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_accepted_by_user_id_users_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "organization_invitations_token_hash_uidx" ON "organization_invitations" USING btree ("token_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX "organization_invitations_pending_email_uidx" ON "organization_invitations" USING btree ("organization_id", "email") WHERE "status" = 'PENDING';
--> statement-breakpoint
CREATE INDEX "organization_invitations_org_updated_idx" ON "organization_invitations" USING btree ("organization_id", "updated_at", "id");
