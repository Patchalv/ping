CREATE TABLE "pending_file_deletion" (
	"object_key" uuid PRIMARY KEY NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text
);
--> statement-breakpoint
CREATE INDEX "pending_file_deletion_requested_at_idx" ON "pending_file_deletion" USING btree ("requested_at");--> statement-breakpoint

-- Attachment removal and the sweepers (#51). Hand-written after the generated DDL, like 0007
-- to 0016.
--
-- pending_file_deletion (permissions.md › Policies): insert only for ping_app, and only the
-- key of an Attachment it can see; the column grant leaves attempts and last_error to the
-- sweeper. ping_system reads, updates and deletes the queue (the file-deletion sweeper) and
-- inserts into it (the pending-upload sweep).
GRANT INSERT ("object_key") ON "pending_file_deletion" TO ping_app;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE, UPDATE ("attempts", "last_error") ON "pending_file_deletion" TO ping_system;--> statement-breakpoint
ALTER TABLE "pending_file_deletion" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "pending_file_deletion" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY pending_file_deletion_insert ON "pending_file_deletion" FOR INSERT TO ping_app
  WITH CHECK (
    (SELECT public.current_staff_is_active())
    AND object_key IN (SELECT a.object_key FROM public.attachment a)
  );--> statement-breakpoint
CREATE POLICY pending_file_deletion_system ON "pending_file_deletion" FOR ALL TO ping_system
  USING (true) WITH CHECK (true);--> statement-breakpoint

-- Removing an Attachment: its uploader, the Channel's admins, or a company Admin, in a
-- Channel they can read (Archived included), only once it's attached and not yet removed.
-- The permissions module checks the same first; this is belt and braces. The column grant
-- lets ping_app mark the removal and nothing else beyond what attaching already allows.
GRANT UPDATE ("removed_at", "removed_by") ON "attachment" TO ping_app;--> statement-breakpoint
CREATE POLICY attachment_remove ON "attachment" FOR UPDATE TO ping_app
  USING (
    (SELECT public.current_staff_is_active())
    AND channel_id IS NOT NULL
    AND removed_at IS NULL
    AND (
      channel_id = ANY (ARRAY(SELECT public.current_staff_channel_ids()))
      OR channel_id IN (SELECT c.id FROM public.channel c WHERE c.visibility = 'public')
    )
    AND (
      uploader_id = (SELECT public.current_staff_id())
      OR channel_id = ANY (ARRAY(SELECT public.current_staff_admin_channel_ids()))
      OR (SELECT public.current_staff_is_admin())
    )
  )
  WITH CHECK (
    (SELECT public.current_staff_is_active())
    AND removed_at IS NOT NULL
    AND removed_by = (SELECT public.current_staff_id())
  );--> statement-breakpoint

-- Permissive policies combine with OR, so the attaching policy's check would otherwise pass
-- a removal too. This restrictive one holds for every update: a removal is recorded only
-- in the acting Staff member's name, and only on an attached Attachment.
CREATE POLICY attachment_removal_as_self ON "attachment" AS RESTRICTIVE FOR UPDATE TO ping_app
  USING (true)
  WITH CHECK (
    (removed_at IS NULL AND removed_by IS NULL)
    OR (
      removed_at IS NOT NULL
      AND channel_id IS NOT NULL
      AND removed_by = (SELECT public.current_staff_id())
    )
  );--> statement-breakpoint

-- An attached Attachment never moves to another post or Channel. The removal policy lets
-- ping_app update attached rows, and a policy can't compare a row with what it was, so a
-- trigger holds the line.
CREATE FUNCTION public.attachment_keep_target() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF OLD.channel_id IS NOT NULL AND (
    NEW.channel_id IS DISTINCT FROM OLD.channel_id
    OR NEW.thread_id IS DISTINCT FROM OLD.thread_id
    OR NEW.thread_response_id IS DISTINCT FROM OLD.thread_response_id
  ) THEN
    RAISE EXCEPTION 'An attached Attachment can''t move to another post';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER attachment_keep_target BEFORE UPDATE ON "attachment"
  FOR EACH ROW EXECUTE FUNCTION public.attachment_keep_target();--> statement-breakpoint

-- The pending-upload sweeper, as ping_system: reads and deletes pending Attachments (no
-- Channel yet) only. Attached ones stay out of its reach.
GRANT SELECT, DELETE ON "attachment" TO ping_system;--> statement-breakpoint
CREATE POLICY attachment_system_sweep ON "attachment" FOR ALL TO ping_system
  USING (channel_id IS NULL);--> statement-breakpoint

-- Thread Responses deleted before this migration kept their Attachments' files (#50 left
-- deleting them to this slice): queue them now, so the sweeper takes them down.
INSERT INTO "pending_file_deletion" ("object_key")
SELECT a.object_key FROM "attachment" a
  JOIN "thread_response" r ON r.id = a.thread_response_id
 WHERE r.deleted_at IS NOT NULL AND a.removed_at IS NULL
ON CONFLICT DO NOTHING