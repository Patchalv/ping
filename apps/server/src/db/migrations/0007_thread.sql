CREATE TYPE "public"."system_thread_kind" AS ENUM('channel_made_private', 'channel_archived', 'channel_admin_replaced');--> statement-breakpoint
CREATE TABLE "thread" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"author_id" uuid,
	"is_system" boolean DEFAULT false NOT NULL,
	"system_kind" "system_thread_kind",
	"system_payload" jsonb,
	"title" text NOT NULL,
	"body" jsonb NOT NULL,
	"body_text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"latest_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"edited_by" uuid,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || body_text)) STORED,
	CONSTRAINT "thread_id_channel_id_unique" UNIQUE("id","channel_id"),
	CONSTRAINT "thread_system_or_authored" CHECK (("thread"."is_system" and "thread"."author_id" is null and "thread"."system_kind" is not null and "thread"."system_payload" is not null)
        or (not "thread"."is_system" and "thread"."author_id" is not null and "thread"."system_kind" is null and "thread"."system_payload" is null)),
	CONSTRAINT "thread_edited_by_with_at" CHECK (("thread"."edited_at" is null) = ("thread"."edited_by" is null)),
	CONSTRAINT "thread_resolved_by_with_at" CHECK (("thread"."resolved_at" is null) = ("thread"."resolved_by" is null))
);
--> statement-breakpoint
ALTER TABLE "thread" ADD CONSTRAINT "thread_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread" ADD CONSTRAINT "thread_author_id_staff_member_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."staff_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread" ADD CONSTRAINT "thread_edited_by_staff_member_id_fk" FOREIGN KEY ("edited_by") REFERENCES "public"."staff_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread" ADD CONSTRAINT "thread_resolved_by_staff_member_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."staff_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "thread_channel_id_latest_activity_at_idx" ON "thread" USING btree ("channel_id","latest_activity_at");--> statement-breakpoint
CREATE INDEX "thread_channel_id_created_at_idx" ON "thread" USING btree ("channel_id","created_at");--> statement-breakpoint
CREATE INDEX "thread_search_idx" ON "thread" USING gin ("search");--> statement-breakpoint

-- Row-level security for Threads (permissions.md › Policies). Hand-written after the
-- generated DDL, like 0001.
--
-- The visibility rule, FOR ALL, with no Admin exception: a Thread is visible when its
-- Channel is Public or the acting Staff member is a member of it. The Public-channel
-- check reads channel through channel's own policy and is uncorrelated, and the
-- membership helper is called as = ANY (ARRAY(SELECT …)), so both run once per statement.
-- Who may start a Thread (members only, not in an Archived channel) is the permissions
-- module's job; the database guards reads.
--
-- ping_app gets only what this slice uses: reading and starting Threads. Editing and
-- deleting (#39) add their grants.
GRANT SELECT, INSERT ON "thread" TO ping_app;--> statement-breakpoint
ALTER TABLE "thread" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "thread" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
-- With no WITH CHECK, Postgres checks inserted and updated rows against USING too.
CREATE POLICY thread_visible ON "thread" FOR ALL TO ping_app
  USING (
    (SELECT public.current_staff_is_active())
    AND (
      channel_id = ANY (ARRAY(SELECT public.current_staff_channel_ids()))
      OR channel_id IN (SELECT c.id FROM public.channel c WHERE c.visibility = 'public')
    )
  );--> statement-breakpoint

-- Belt and braces: a Thread inserted through ping_app is an ordinary one by the acting
-- Staff member. System threads are started by system functions only.
CREATE POLICY thread_insert_as_self ON "thread" AS RESTRICTIVE FOR INSERT TO ping_app
  WITH CHECK (NOT is_system AND author_id = (SELECT public.current_staff_id()));
