-- Nobody chooses their own joined_at (data-model.md › channel_member). It decides who is
-- auto-promoted when a sole Channel admin is Deactivated (the earliest wins), so a
-- backdated row would win that. Hand-written, like 0000. From "Browse, join and leave
-- Public channels" (#36).
--
-- Insert: the same two rules as 0001, and joined_at must be now(), the transaction's start
-- time: the column default, so an insert that leaves joined_at out passes. A Channel admin
-- adding someone is held to it too.
DROP POLICY channel_member_insert ON "channel_member";--> statement-breakpoint
CREATE POLICY channel_member_insert ON "channel_member" FOR INSERT TO ping_app
  WITH CHECK (
    joined_at = now()
    AND (
      (
        staff_id = (SELECT public.current_staff_id())
        AND NOT is_channel_admin
        AND (SELECT public.current_staff_is_active())
        AND channel_id IN (SELECT c.id FROM public.channel c WHERE c.visibility = 'public')
      )
      OR channel_id = ANY (ARRAY(SELECT public.current_staff_admin_channel_ids()))
    )
  );--> statement-breakpoint

-- Update: a policy can't compare old and new values, so ping_app may update only the
-- column the app changes (appointing or removing a Channel admin), as 0004 does for
-- staff_member.
REVOKE UPDATE ON "channel_member" FROM ping_app;--> statement-breakpoint
GRANT UPDATE ("is_channel_admin") ON "channel_member" TO ping_app;
