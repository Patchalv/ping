-- System function (permissions.md › System functions, data-model.md › The clean-up
-- routine): the Deactivation clean-up, for every Channel the Deactivated Staff member was
-- in, Private channels the acting Admin can't see included. Hand-written, like 0000.
--
-- The Admin's request does the rest in the same transaction, through ping_app: it sets
-- deactivated_at = now() and deactivated_by, and deletes their sessions. This function then:
--
-- 1. promotes a replacement where they were the Channel's only active Channel admin: the
--    active member who joined earliest, a tie going to whoever became a Staff member first
--    (data-model.md › Channels);
-- 2. archives a Channel left with no active members. A 1:1 Private channel keeps one
--    active member, who becomes its Channel admin under step 1, so it stays open.
--
-- Their channel_member rows and Channel admin roles stay, so reactivation restores them.
-- Later slices add their steps here: drop their Pings (#46), Saved and mutes (#48) and
-- Section placements (#44), and start the promotion's System thread (#42).
--
-- It acts only for the active Admin in app.staff_id, and only on a Staff member that Admin
-- Deactivated in this very transaction (deactivated_at is the transaction's now()), so its
-- argument can't steer it at anyone else. Anything else raises, rolling the request back.
-- The route holds the staff-management lock, so two Deactivations never race on one
-- Channel's Channel admins.
--
-- Answers one row per Channel it changed: who was promoted (or null) and whether it was
-- archived, for live updates and the System threads.
CREATE FUNCTION public.deactivate_staff_member(target uuid)
  RETURNS TABLE (channel_id uuid, promoted_staff_id uuid, archived boolean)
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  #variable_conflict use_column
  DECLARE
    actor uuid := public.current_staff_id();
    lost record;
    promoted uuid;
    was_archived boolean;
  BEGIN
    IF actor IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM public.staff_member a
         WHERE a.id = actor AND a.role = 'admin' AND a.deactivated_at IS NULL
      )
      OR NOT EXISTS (
        SELECT 1 FROM public.staff_member t
         WHERE t.id = target AND t.deactivated_by = actor AND t.deactivated_at = now()
      )
    THEN
      RAISE EXCEPTION 'deactivate_staff_member refused: app.staff_id must be an active Admin who Deactivated this Staff member in this transaction';
    END IF;

    FOR lost IN
      SELECT m.channel_id AS id, m.is_channel_admin, c.archived_at
        FROM public.channel_member m
        JOIN public.channel c ON c.id = m.channel_id
       WHERE m.staff_id = target
       ORDER BY m.channel_id
    LOOP
      promoted := NULL;
      was_archived := false;

      IF lost.is_channel_admin AND NOT EXISTS (
        SELECT 1 FROM public.channel_member m
          JOIN public.staff_member s ON s.id = m.staff_id
         WHERE m.channel_id = lost.id AND m.is_channel_admin AND s.deactivated_at IS NULL
      ) THEN
        SELECT m.staff_id INTO promoted
          FROM public.channel_member m
          JOIN public.staff_member s ON s.id = m.staff_id
         WHERE m.channel_id = lost.id AND s.deactivated_at IS NULL
         ORDER BY m.joined_at, s.created_at, s.id
         LIMIT 1;
        IF promoted IS NOT NULL THEN
          UPDATE public.channel_member m SET is_channel_admin = true
           WHERE m.channel_id = lost.id AND m.staff_id = promoted;
        END IF;
      END IF;

      IF lost.archived_at IS NULL AND NOT EXISTS (
        SELECT 1 FROM public.channel_member m
          JOIN public.staff_member s ON s.id = m.staff_id
         WHERE m.channel_id = lost.id AND s.deactivated_at IS NULL
      ) THEN
        UPDATE public.channel c SET archived_at = now(), archived_by = actor WHERE c.id = lost.id;
        was_archived := true;
      END IF;

      IF promoted IS NOT NULL OR was_archived THEN
        channel_id := lost.id;
        promoted_staff_id := promoted;
        archived := was_archived;
        RETURN NEXT;
      END IF;
    END LOOP;
  END
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.deactivate_staff_member(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.deactivate_staff_member(uuid) TO ping_app;
