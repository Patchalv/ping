CREATE TABLE "attachment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid,
	"thread_id" uuid,
	"thread_response_id" uuid,
	"uploader_id" uuid NOT NULL,
	"object_key" uuid NOT NULL,
	"original_filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by" uuid,
	CONSTRAINT "attachment_object_key_unique" UNIQUE("object_key"),
	CONSTRAINT "attachment_at_most_one_target" CHECK ("attachment"."thread_id" is null or "attachment"."thread_response_id" is null),
	CONSTRAINT "attachment_channel_with_target" CHECK (("attachment"."channel_id" is null) = ("attachment"."thread_id" is null and "attachment"."thread_response_id" is null)),
	CONSTRAINT "attachment_size_positive" CHECK ("attachment"."size_bytes" > 0)
);
--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_uploader_id_staff_member_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."staff_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_removed_by_staff_member_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."staff_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_thread_fk" FOREIGN KEY ("thread_id","channel_id") REFERENCES "public"."thread"("id","channel_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_thread_response_fk" FOREIGN KEY ("thread_response_id","channel_id") REFERENCES "public"."thread_response"("id","channel_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachment_thread_id_idx" ON "attachment" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "attachment_thread_response_id_idx" ON "attachment" USING btree ("thread_response_id");--> statement-breakpoint
CREATE INDEX "attachment_pending_idx" ON "attachment" USING btree ("uploader_id","created_at") WHERE "attachment"."channel_id" is null;--> statement-breakpoint

-- Attachments (#50). Hand-written after the generated DDL, like 0007 to 0014.
--
-- Row-level security (permissions.md › Policies):
-- - Pending (no Channel): its uploader only. ping_app inserts only its own pending rows.
-- - Attached: the visibility rule, with no Admin exception, the same as thread's.
-- - Attaching is the only update: the uploader moves their own pending row onto a post in
--   a Channel they can read, and only a post they may edit (their own, or any as a company
--   Admin). The permissions module checks the same first; this is belt and braces. The
--   column grant keeps everything else (the object key, the filename, the type, the size)
--   as the server wrote it.
--
-- ping_app has no DELETE: removal and the pending sweeper arrive with #51. Deleting a
-- Thread or Thread Response row cascades here through the foreign keys.
GRANT SELECT, INSERT ON "attachment" TO ping_app;--> statement-breakpoint
GRANT UPDATE ("channel_id", "thread_id", "thread_response_id") ON "attachment" TO ping_app;--> statement-breakpoint
ALTER TABLE "attachment" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "attachment" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY attachment_visible ON "attachment" FOR SELECT TO ping_app
  USING (
    (SELECT public.current_staff_is_active())
    AND (
      (channel_id IS NULL AND uploader_id = (SELECT public.current_staff_id()))
      OR channel_id = ANY (ARRAY(SELECT public.current_staff_channel_ids()))
      OR channel_id IN (SELECT c.id FROM public.channel c WHERE c.visibility = 'public')
    )
  );--> statement-breakpoint
CREATE POLICY attachment_insert_pending ON "attachment" FOR INSERT TO ping_app
  WITH CHECK (
    (SELECT public.current_staff_is_active())
    AND uploader_id = (SELECT public.current_staff_id())
    AND channel_id IS NULL AND thread_id IS NULL AND thread_response_id IS NULL
  );--> statement-breakpoint
CREATE POLICY attachment_attach_own_pending ON "attachment" FOR UPDATE TO ping_app
  USING (
    (SELECT public.current_staff_is_active())
    AND channel_id IS NULL
    AND uploader_id = (SELECT public.current_staff_id())
  )
  WITH CHECK (
    (SELECT public.current_staff_is_active())
    AND uploader_id = (SELECT public.current_staff_id())
    AND (
      channel_id = ANY (ARRAY(SELECT public.current_staff_channel_ids()))
      OR channel_id IN (SELECT c.id FROM public.channel c WHERE c.visibility = 'public')
    )
    AND (
      (SELECT public.current_staff_is_admin())
      OR thread_id IN (
        SELECT t.id FROM public.thread t WHERE t.author_id = (SELECT public.current_staff_id()))
      OR thread_response_id IN (
        SELECT r.id FROM public.thread_response r
         WHERE r.author_id = (SELECT public.current_staff_id()) AND r.deleted_at IS NULL)
    )
  );
