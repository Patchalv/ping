CREATE TABLE "thread_response" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"thread_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"author_id" uuid NOT NULL,
	"body" jsonb,
	"body_text" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"edited_at" timestamp with time zone,
	"edited_by" uuid,
	"deleted_at" timestamp with time zone,
	"deleted_by" uuid,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', coalesce(body_text, ''))) STORED,
	CONSTRAINT "thread_response_body_unless_deleted" CHECK (("thread_response"."deleted_at" is null and "thread_response"."body" is not null and "thread_response"."body_text" is not null)
        or ("thread_response"."deleted_at" is not null and "thread_response"."body" is null and "thread_response"."body_text" is null)),
	CONSTRAINT "thread_response_edited_by_with_at" CHECK (("thread_response"."edited_at" is null) = ("thread_response"."edited_by" is null)),
	CONSTRAINT "thread_response_deleted_by_with_at" CHECK (("thread_response"."deleted_at" is null) = ("thread_response"."deleted_by" is null))
);
--> statement-breakpoint
ALTER TABLE "thread_response" ADD CONSTRAINT "thread_response_author_id_staff_member_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."staff_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_response" ADD CONSTRAINT "thread_response_edited_by_staff_member_id_fk" FOREIGN KEY ("edited_by") REFERENCES "public"."staff_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_response" ADD CONSTRAINT "thread_response_deleted_by_staff_member_id_fk" FOREIGN KEY ("deleted_by") REFERENCES "public"."staff_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "thread_response" ADD CONSTRAINT "thread_response_thread_fk" FOREIGN KEY ("thread_id","channel_id") REFERENCES "public"."thread"("id","channel_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "thread_response_thread_id_created_at_idx" ON "thread_response" USING btree ("thread_id","created_at");--> statement-breakpoint
CREATE INDEX "thread_response_search_idx" ON "thread_response" USING gin ("search");--> statement-breakpoint

-- Row-level security for Thread Responses (permissions.md › Policies). Hand-written after
-- the generated DDL, like 0007.
--
-- The visibility rule, FOR ALL, with no Admin exception, the same as thread's: both
-- checks are uncorrelated and run once per statement. Who may send, edit or delete
-- (members send; authors and company Admins edit and delete) is the permissions module's
-- job; the database guards reads.
--
-- ping_app may read, send, and update only the content and edit/delete marks. A Thread
-- Response is never deleted outright by ping_app: deleting one nulls its body and keeps
-- the row as the placeholder, and deleting its Thread cascades here.
GRANT SELECT, INSERT ON "thread_response" TO ping_app;--> statement-breakpoint
GRANT UPDATE (body, body_text, edited_at, edited_by, deleted_at, deleted_by) ON "thread_response" TO ping_app;--> statement-breakpoint
ALTER TABLE "thread_response" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "thread_response" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY thread_response_visible ON "thread_response" FOR ALL TO ping_app
  USING (
    (SELECT public.current_staff_is_active())
    AND (
      channel_id = ANY (ARRAY(SELECT public.current_staff_channel_ids()))
      OR channel_id IN (SELECT c.id FROM public.channel c WHERE c.visibility = 'public')
    )
  );--> statement-breakpoint

-- Belt and braces: a Thread Response inserted through ping_app is by the acting Staff
-- member, and isn't born deleted.
CREATE POLICY thread_response_insert_as_self ON "thread_response" AS RESTRICTIVE FOR INSERT TO ping_app
  WITH CHECK (author_id = (SELECT public.current_staff_id()) AND deleted_at IS NULL);--> statement-breakpoint

-- Editing and deleting Threads (#39). ping_app may change only a Thread's content, its
-- edit mark and its Latest activity, never who started it, where, or whether Ping did.
-- Deleting a Thread is a real delete; its Thread Responses go with it by cascade.
GRANT UPDATE (title, body, body_text, edited_at, edited_by, latest_activity_at) ON "thread" TO ping_app;--> statement-breakpoint
GRANT DELETE ON "thread" TO ping_app;
