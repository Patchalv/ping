-- Channel settings, visibility change and System threads (#42). Hand-written: no schema
-- change, only grants, a policy and a system function.
--
-- channel: ping_app may now update a Channel's name, description and "Who can resolve
-- threads?", as one of its active Channel admins (permissions.md › Policies: "the settings
-- slice adds a column-limited UPDATE"). Not visibility: turning a Channel Private goes
-- through make_channel_private below, and nothing ever makes one Public. Not created_by or
-- archived_at/by either. The finer rules (nothing changes in an Archived channel) stay in
-- the server's permissions module.
GRANT UPDATE (name, description, resolve_policy) ON "channel" TO ping_app;--> statement-breakpoint
CREATE POLICY channel_update ON "channel" FOR UPDATE TO ping_app
  USING (
    (SELECT public.current_staff_is_active())
    AND id = ANY (ARRAY(SELECT public.current_staff_admin_channel_ids()))
  )
  WITH CHECK (
    (SELECT public.current_staff_is_active())
    AND id = ANY (ARRAY(SELECT public.current_staff_admin_channel_ids()))
  );--> statement-breakpoint

-- Turning a Public channel Private (product.md › Channels, › System threads). One fixed
-- job, in the request's transaction: flip the visibility, start the System thread
-- (channel_made_private, its payload the acting Staff member's ID, rendered by name when
-- read), and Ping every other active Channel member for it, mutes ignored, like any new
-- Thread. The server then calls clean_up_lost_access in the same transaction, which now
-- sees a Private channel and drops every non-member's Pings, Saved Threads and mutes.
--
-- It guards itself, because any ping_app connection can call it: it acts only for an
-- active Channel admin of that Channel in app.staff_id, on a Public channel that isn't
-- Archived. The visibility check is in the UPDATE itself, so two Channel admins acting at
-- once start one System thread between them. Returns the System thread's ID, or null when
-- it changed nothing. It never makes a Channel Public.
CREATE FUNCTION public.make_channel_private(target_channel_id uuid)
  RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    actor uuid := public.current_staff_id();
    system_thread uuid;
  BEGIN
    IF actor IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.channel_member m
        JOIN public.staff_member s ON s.id = m.staff_id
       WHERE m.channel_id = target_channel_id AND m.staff_id = actor AND m.is_channel_admin
         AND s.deactivated_at IS NULL
    ) THEN
      RETURN NULL;
    END IF;

    UPDATE public.channel SET visibility = 'private'
     WHERE id = target_channel_id AND visibility = 'public' AND archived_at IS NULL;
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;

    INSERT INTO public.thread
        (channel_id, author_id, is_system, system_kind, system_payload, title, body, body_text)
      VALUES (
        target_channel_id, NULL, true, 'channel_made_private',
        jsonb_build_object('staffId', actor),
        'This Channel was made Private',
        '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Only its members can find and read it now. Everyone else lost access to it."}]}]}'::jsonb,
        'Only its members can find and read it now. Everyone else lost access to it.'
      )
      RETURNING id INTO system_thread;

    INSERT INTO public.ping (staff_id, thread_id, channel_id)
      SELECT m.staff_id, system_thread, target_channel_id
        FROM public.channel_member m
        JOIN public.staff_member s ON s.id = m.staff_id
       WHERE m.channel_id = target_channel_id
         AND m.staff_id <> actor
         AND s.joined_at IS NOT NULL
         AND s.deactivated_at IS NULL;

    RETURN system_thread;
  END
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.make_channel_private(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.make_channel_private(uuid) TO ping_app;
