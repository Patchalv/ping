-- Archive and unarchive a Channel (#43). Hand-written: no schema change, only two system
-- functions. ping_app has no grant on archived_at/by, and a company Admin who isn't
-- Channel admin can't pass the channel_update policy, so archiving goes through these.
--
-- Who may (permissions.md › Channels): an active Channel admin of the Channel, or an active
-- company Admin on a Public channel or on a Private channel they're a member of. The
-- server decides first, but any ping_app connection can call them, so each guards itself
-- on app.staff_id with the same rule. The archived_at check is in each UPDATE itself, so
-- two Staff members acting at once change it once between them.

-- Archiving (product.md › Archive, › System threads). One fixed job, in the request's
-- transaction: set archived_at/by, start the System thread (channel_archived, its payload
-- the acting Staff member's ID, rendered by name when read), and Ping every other active
-- Channel member for it, mutes ignored, like any new Thread. Nobody else is Pinged, and
-- open Pings stay until they're Acknowledged. Returns the System thread's ID, or null when
-- it changed nothing.
CREATE FUNCTION public.archive_channel(target_channel_id uuid)
  RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    actor uuid := public.current_staff_id();
    system_thread uuid;
  BEGIN
    IF actor IS NULL OR NOT public.current_staff_is_active() OR NOT EXISTS (
      SELECT 1 FROM public.channel c
       WHERE c.id = target_channel_id
         AND (
           EXISTS (
             SELECT 1 FROM public.channel_member m
              WHERE m.channel_id = c.id AND m.staff_id = actor AND m.is_channel_admin
           )
           OR (public.current_staff_is_admin() AND (
             c.visibility = 'public' OR EXISTS (
               SELECT 1 FROM public.channel_member m
                WHERE m.channel_id = c.id AND m.staff_id = actor
             )
           ))
         )
    ) THEN
      RETURN NULL;
    END IF;

    UPDATE public.channel SET archived_at = now(), archived_by = actor
     WHERE id = target_channel_id AND archived_at IS NULL;
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;

    INSERT INTO public.thread
        (channel_id, author_id, is_system, system_kind, system_payload, title, body, body_text)
      VALUES (
        target_channel_id, NULL, true, 'channel_archived',
        jsonb_build_object('staffId', actor),
        'This Channel was archived',
        '{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"It stays readable, but nobody can start Threads, respond, react or change it until it is unarchived."}]}]}'::jsonb,
        'It stays readable, but nobody can start Threads, respond, react or change it until it is unarchived.'
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
REVOKE ALL ON FUNCTION public.archive_channel(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.archive_channel(uuid) TO ping_app;--> statement-breakpoint

-- Unarchiving: clears archived_at/by. It starts no System thread and Pings nobody.
-- Returns whether it changed anything.
CREATE FUNCTION public.unarchive_channel(target_channel_id uuid)
  RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    actor uuid := public.current_staff_id();
  BEGIN
    IF actor IS NULL OR NOT public.current_staff_is_active() OR NOT EXISTS (
      SELECT 1 FROM public.channel c
       WHERE c.id = target_channel_id
         AND (
           EXISTS (
             SELECT 1 FROM public.channel_member m
              WHERE m.channel_id = c.id AND m.staff_id = actor AND m.is_channel_admin
           )
           OR (public.current_staff_is_admin() AND (
             c.visibility = 'public' OR EXISTS (
               SELECT 1 FROM public.channel_member m
                WHERE m.channel_id = c.id AND m.staff_id = actor
             )
           ))
         )
    ) THEN
      RETURN false;
    END IF;

    UPDATE public.channel SET archived_at = NULL, archived_by = NULL
     WHERE id = target_channel_id AND archived_at IS NOT NULL;
    RETURN FOUND;
  END
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.unarchive_channel(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.unarchive_channel(uuid) TO ping_app;
