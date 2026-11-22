-- Channel members and Channel admins (#37). Hand-written after the generated column, like
-- 0000.
--
-- audit_event records membership changes, so it needs the Channel they happened in.
ALTER TABLE "audit_event" ADD COLUMN "channel_id" uuid;--> statement-breakpoint

-- Insert: any active member adds people to a Public channel, as plain members
-- (product.md › Members and Channel admins). Before, a plain member could add only
-- themself. The other rules are 0005's: your own plain row in a Public channel (joining),
-- or any row in a Channel you are Channel admin of, and joined_at is always now().
DROP POLICY channel_member_insert ON "channel_member";--> statement-breakpoint
CREATE POLICY channel_member_insert ON "channel_member" FOR INSERT TO ping_app
  WITH CHECK (
    joined_at = now()
    AND (
      (
        NOT is_channel_admin
        AND (SELECT public.current_staff_is_active())
        AND channel_id IN (SELECT c.id FROM public.channel c WHERE c.visibility = 'public')
        AND (
          staff_id = (SELECT public.current_staff_id())
          OR channel_id = ANY (ARRAY(SELECT public.current_staff_channel_ids()))
        )
      )
      OR channel_id = ANY (ARRAY(SELECT public.current_staff_admin_channel_ids()))
    )
  );--> statement-breakpoint

-- System function (permissions.md › System functions): a company Admin appoints anyone,
-- themself included, as Channel admin of a Public channel, or removes the role. The
-- channel_member policies have no Admin exception (ADR 0005), so this is the only way.
-- Called by the system-actions module only, after the server has authorised the request.
-- It still guards itself, because any ping_app connection can call it: it acts only for an
-- active Admin in app.staff_id, on a Public channel that isn't Archived, appoints only an
-- active Staff member, and never removes the last active Channel admin. Appointing someone
-- who isn't a member adds them, at the transaction's time. Returns true when it changed a
-- row.
CREATE FUNCTION public.admin_set_channel_admin(
  target_channel_id uuid,
  target_staff_id uuid,
  make_channel_admin boolean
) RETURNS boolean
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  BEGIN
    IF NOT public.current_staff_is_admin() THEN
      RETURN false;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.channel
       WHERE id = target_channel_id AND visibility = 'public' AND archived_at IS NULL
    ) THEN
      RETURN false;
    END IF;

    IF make_channel_admin THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.staff_member
         WHERE id = target_staff_id AND joined_at IS NOT NULL AND deactivated_at IS NULL
      ) THEN
        RETURN false;
      END IF;
      INSERT INTO public.channel_member (channel_id, staff_id, is_channel_admin)
        VALUES (target_channel_id, target_staff_id, true)
        ON CONFLICT (channel_id, staff_id) DO UPDATE SET is_channel_admin = true
        WHERE NOT public.channel_member.is_channel_admin;
      RETURN FOUND;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM public.channel_member m
        JOIN public.staff_member s ON s.id = m.staff_id
       WHERE m.channel_id = target_channel_id
         AND m.staff_id <> target_staff_id
         AND m.is_channel_admin
         AND s.deactivated_at IS NULL
    ) THEN
      RETURN false;
    END IF;
    UPDATE public.channel_member SET is_channel_admin = false
     WHERE channel_id = target_channel_id AND staff_id = target_staff_id AND is_channel_admin;
    RETURN FOUND;
  END
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.admin_set_channel_admin(uuid, uuid, boolean) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.admin_set_channel_admin(uuid, uuid, boolean) TO ping_app;
