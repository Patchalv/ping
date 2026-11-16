CREATE TABLE "staff_invite" (
	"staff_id" uuid PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"email_failed_at" timestamp with time zone,
	CONSTRAINT "staff_invite_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "staff_invite" ADD CONSTRAINT "staff_invite_staff_id_staff_member_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invite" ADD CONSTRAINT "staff_invite_created_by_staff_member_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- Row-level security for invites (permissions.md › Policies). Hand-written, like 0000.
--
-- staff_invite: every command is for active Admins only, through ping_app. Inviting,
-- Resend and Cancel run as the Admin.
GRANT SELECT, INSERT, UPDATE, DELETE ON "staff_invite" TO ping_app;--> statement-breakpoint
ALTER TABLE "staff_invite" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "staff_invite" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY staff_invite_admin ON "staff_invite" FOR ALL TO ping_app
  USING ((SELECT public.current_staff_is_admin()))
  WITH CHECK ((SELECT public.current_staff_is_admin()));--> statement-breakpoint

-- ping_system runs the work with no signed-in Staff member behind it (permissions.md ›
-- Roles): accepting an invite (read and lock the invite, insert the password account,
-- mark the email verified, set joined_at, delete the invite) and bootstrap-admin (check
-- that no Admin exists, insert the user, staff_member and staff_invite rows, and mark a
-- failed email). Grants are limited to those commands and columns.
GRANT SELECT, INSERT, DELETE, UPDATE ("email_failed_at") ON "staff_invite" TO ping_system;--> statement-breakpoint
CREATE POLICY staff_invite_system ON "staff_invite" FOR ALL TO ping_system
  USING (true) WITH CHECK (true);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ("joined_at") ON "staff_member" TO ping_system;--> statement-breakpoint
CREATE POLICY staff_member_system ON "staff_member" FOR ALL TO ping_system
  USING (true) WITH CHECK (true);--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ("email_verified", "updated_at") ON "user" TO ping_system;--> statement-breakpoint
GRANT INSERT ON "account" TO ping_system;
