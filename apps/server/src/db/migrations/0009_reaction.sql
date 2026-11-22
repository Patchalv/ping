CREATE TABLE "reaction" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"thread_id" uuid,
	"thread_response_id" uuid,
	"staff_id" uuid NOT NULL,
	"emoji" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reaction_exactly_one_target" CHECK (("reaction"."thread_id" is not null) <> ("reaction"."thread_response_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "thread_response" ADD CONSTRAINT "thread_response_id_channel_id_unique" UNIQUE("id","channel_id");--> statement-breakpoint
ALTER TABLE "reaction" ADD CONSTRAINT "reaction_staff_id_staff_member_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reaction" ADD CONSTRAINT "reaction_thread_fk" FOREIGN KEY ("thread_id","channel_id") REFERENCES "public"."thread"("id","channel_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reaction" ADD CONSTRAINT "reaction_thread_response_fk" FOREIGN KEY ("thread_response_id","channel_id") REFERENCES "public"."thread_response"("id","channel_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reaction_thread_staff_emoji_unique" ON "reaction" USING btree ("thread_id","staff_id","emoji") WHERE "reaction"."thread_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "reaction_thread_response_staff_emoji_unique" ON "reaction" USING btree ("thread_response_id","staff_id","emoji") WHERE "reaction"."thread_response_id" is not null;--> statement-breakpoint

-- Row-level security for reactions (permissions.md › Policies). Hand-written after the
-- generated DDL, like 0007 and 0008.
--
-- The visibility rule, FOR ALL, with no Admin exception, the same as thread's. Two
-- restrictive policies narrow writes: a Staff member adds only their own reactions, and
-- only in a Channel they belong to (reacting takes membership, even in a Public channel);
-- and removes only their own, apart from the reactions of a deleted Thread Response, which
-- go with it. Whether the Channel is archived is the permissions module's job.
--
-- ping_app never updates a reaction: it exists or it doesn't.
GRANT SELECT, INSERT, DELETE ON "reaction" TO ping_app;--> statement-breakpoint
ALTER TABLE "reaction" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reaction" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY reaction_visible ON "reaction" FOR ALL TO ping_app
  USING (
    (SELECT public.current_staff_is_active())
    AND (
      channel_id = ANY (ARRAY(SELECT public.current_staff_channel_ids()))
      OR channel_id IN (SELECT c.id FROM public.channel c WHERE c.visibility = 'public')
    )
  );--> statement-breakpoint
CREATE POLICY reaction_insert_as_member ON "reaction" AS RESTRICTIVE FOR INSERT TO ping_app
  WITH CHECK (
    staff_id = (SELECT public.current_staff_id())
    AND channel_id = ANY (ARRAY(SELECT public.current_staff_channel_ids()))
  );--> statement-breakpoint
CREATE POLICY reaction_delete_own_or_deleted_target ON "reaction" AS RESTRICTIVE FOR DELETE TO ping_app
  USING (
    staff_id = (SELECT public.current_staff_id())
    OR thread_response_id IN (
      SELECT tr.id FROM public.thread_response tr WHERE tr.deleted_at IS NOT NULL)
  );
