CREATE TABLE "mute" (
	"staff_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"thread_id" uuid,
	CONSTRAINT "mute_staff_id_channel_id_thread_id_unique" UNIQUE NULLS NOT DISTINCT("staff_id","channel_id","thread_id")
);
--> statement-breakpoint
CREATE TABLE "saved_thread" (
	"staff_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_thread_staff_id_thread_id_pk" PRIMARY KEY("staff_id","thread_id")
);
--> statement-breakpoint
ALTER TABLE "mute" ADD CONSTRAINT "mute_staff_id_staff_member_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mute" ADD CONSTRAINT "mute_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mute" ADD CONSTRAINT "mute_thread_fk" FOREIGN KEY ("thread_id","channel_id") REFERENCES "public"."thread"("id","channel_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_thread" ADD CONSTRAINT "saved_thread_staff_id_staff_member_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_thread" ADD CONSTRAINT "saved_thread_thread_fk" FOREIGN KEY ("thread_id","channel_id") REFERENCES "public"."thread"("id","channel_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saved_thread_staff_id_saved_at_idx" ON "saved_thread" USING btree ("staff_id","saved_at");
--> statement-breakpoint
-- Saved and Mute (#48). Hand-written after the generated DDL, like 0010 and 0011.
--
-- Row-level security: a Staff member reads, adds and removes only their own Saved Threads
-- and mutes, in Channels they can read (the visibility rule, with no Admin exception), as
-- an uncorrelated = ANY (ARRAY(SELECT …)) so it runs once per statement. A Channel mute
-- (thread_id null) also needs membership. ping_app never updates either: other people's
-- rows go through clean_up_lost_access and deactivate_staff_member.
GRANT SELECT, INSERT, DELETE ON "saved_thread" TO ping_app;--> statement-breakpoint
ALTER TABLE "saved_thread" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "saved_thread" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY saved_thread_own ON "saved_thread" FOR ALL TO ping_app
  USING (
    staff_id = (SELECT public.current_staff_id())
    AND (SELECT public.current_staff_is_active())
    AND (
      channel_id = ANY (ARRAY(SELECT public.current_staff_channel_ids()))
      OR channel_id IN (SELECT c.id FROM public.channel c WHERE c.visibility = 'public')
    )
  )
  WITH CHECK (
    staff_id = (SELECT public.current_staff_id())
    AND (SELECT public.current_staff_is_active())
    AND (
      channel_id = ANY (ARRAY(SELECT public.current_staff_channel_ids()))
      OR channel_id IN (SELECT c.id FROM public.channel c WHERE c.visibility = 'public')
    )
  );--> statement-breakpoint

GRANT SELECT, INSERT, DELETE ON "mute" TO ping_app;--> statement-breakpoint
ALTER TABLE "mute" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mute" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY mute_own ON "mute" FOR ALL TO ping_app
  USING (
    staff_id = (SELECT public.current_staff_id())
    AND (SELECT public.current_staff_is_active())
    AND (
      channel_id = ANY (ARRAY(SELECT public.current_staff_channel_ids()))
      OR channel_id IN (SELECT c.id FROM public.channel c WHERE c.visibility = 'public')
    )
  )
  WITH CHECK (
    staff_id = (SELECT public.current_staff_id())
    AND (SELECT public.current_staff_is_active())
    AND (
      channel_id = ANY (ARRAY(SELECT public.current_staff_channel_ids()))
      OR (
        thread_id IS NOT NULL
        AND channel_id IN (SELECT c.id FROM public.channel c WHERE c.visibility = 'public')
      )
    )
  );--> statement-breakpoint

-- The Ping fan-out now follows Mute and Saved (product.md › Who gets a Ping). A
-- redefinition of 0010's function; grants and the pinned search_path carry over.
--
-- A new Thread still Pings every other active member, mutes ignored. A new Thread Response
-- Pings every other active member who hasn't muted the Channel or the Thread, plus every
-- other active Staff member who has Saved the Thread and can still read it (a member, or
-- anyone for a Public channel), even after leaving. Saved wins over a mute: Saving adds
-- you to the fan-out, and a mute only takes away Channel members. UNION, not UNION ALL,
-- because a member who Saved the Thread would otherwise come twice, and ON CONFLICT can't
-- touch one row twice in a statement.
CREATE OR REPLACE FUNCTION public.fan_out_pings(target_thread_id uuid, target_response_id uuid DEFAULT NULL)
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    actor uuid := public.current_staff_id();
    target_channel uuid;
    bumped integer;
  BEGIN
    IF actor IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.staff_member WHERE id = actor AND deactivated_at IS NULL
    ) THEN
      RETURN 0;
    END IF;

    IF target_response_id IS NULL THEN
      SELECT t.channel_id INTO target_channel FROM public.thread t
       WHERE t.id = target_thread_id AND t.author_id = actor AND t.created_at = now();
    ELSE
      SELECT r.channel_id INTO target_channel FROM public.thread_response r
       WHERE r.id = target_response_id AND r.thread_id = target_thread_id
         AND r.author_id = actor AND r.created_at = now();
    END IF;
    IF target_channel IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.channel_member m
       WHERE m.channel_id = target_channel AND m.staff_id = actor
    ) THEN
      RETURN 0;
    END IF;

    INSERT INTO public.ping (staff_id, thread_id, channel_id)
      SELECT recipient.staff_id, target_thread_id, target_channel
        FROM (
          SELECT m.staff_id
            FROM public.channel_member m
           WHERE m.channel_id = target_channel
             AND (
               target_response_id IS NULL
               OR NOT EXISTS (
                 SELECT 1 FROM public.mute u
                  WHERE u.staff_id = m.staff_id AND u.channel_id = target_channel
                    AND (u.thread_id IS NULL OR u.thread_id = target_thread_id)
               )
             )
          UNION
          SELECT st.staff_id
            FROM public.saved_thread st
           WHERE target_response_id IS NOT NULL
             AND st.thread_id = target_thread_id
             AND (
               EXISTS (
                 SELECT 1 FROM public.channel c
                  WHERE c.id = target_channel AND c.visibility = 'public'
               )
               OR EXISTS (
                 SELECT 1 FROM public.channel_member m
                  WHERE m.channel_id = target_channel AND m.staff_id = st.staff_id
               )
             )
        ) recipient
        JOIN public.staff_member s ON s.id = recipient.staff_id
       WHERE recipient.staff_id <> actor
         AND s.joined_at IS NOT NULL
         AND s.deactivated_at IS NULL
      ON CONFLICT (staff_id, thread_id) DO UPDATE
        SET count = public.ping.count + 1, last_at = now();
    GET DIAGNOSTICS bumped = ROW_COUNT;
    RETURN bumped;
  END
  $$;--> statement-breakpoint

-- The losing-access clean-up now drops Saved Threads and mutes too (0010 named this slice).
-- A redefinition of 0011's function; grants and the pinned search_path carry over.
--
-- data-model.md › The clean-up routine, worked from the Channel's current state:
-- - A Private channel: everyone not in it loses their Pings, Saved Threads and mutes.
-- - A Public channel: everyone not in it loses their Channel mute, which needs
--   membership. Pings and Saved stay, because they can still read it. Thread mutes go
--   only for the acting Staff member when they're no longer in it (leaving): other
--   readers who never joined may mute a Thread, and someone else leaving mustn't touch
--   theirs.
-- - Section placement goes for everyone not in it, as before.
-- It never takes a Staff member in an argument, so it can't touch anyone who still has
-- access. Returns how many Pings it dropped, as before.
CREATE OR REPLACE FUNCTION public.clean_up_lost_access(target_channel_id uuid)
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    actor uuid := public.current_staff_id();
    is_private boolean;
    dropped integer;
  BEGIN
    IF actor IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.staff_member WHERE id = actor AND deactivated_at IS NULL
    ) THEN
      RETURN 0;
    END IF;

    SELECT c.visibility = 'private' INTO is_private
      FROM public.channel c WHERE c.id = target_channel_id;

    DELETE FROM public.section_channel sc
     WHERE sc.channel_id = target_channel_id
       AND NOT EXISTS (
         SELECT 1 FROM public.channel_member m
          WHERE m.channel_id = target_channel_id AND m.staff_id = sc.staff_id
       );

    DELETE FROM public.mute u
     WHERE u.channel_id = target_channel_id
       AND (is_private OR u.thread_id IS NULL OR u.staff_id = actor)
       AND NOT EXISTS (
         SELECT 1 FROM public.channel_member m
          WHERE m.channel_id = target_channel_id AND m.staff_id = u.staff_id
       );

    IF NOT is_private THEN
      RETURN 0;
    END IF;

    DELETE FROM public.saved_thread st
     WHERE st.channel_id = target_channel_id
       AND NOT EXISTS (
         SELECT 1 FROM public.channel_member m
          WHERE m.channel_id = target_channel_id AND m.staff_id = st.staff_id
       );

    DELETE FROM public.ping p
     WHERE p.channel_id = target_channel_id
       AND NOT EXISTS (
         SELECT 1 FROM public.channel_member m
          WHERE m.channel_id = target_channel_id AND m.staff_id = p.staff_id
       );
    GET DIAGNOSTICS dropped = ROW_COUNT;
    RETURN dropped;
  END
  $$;--> statement-breakpoint

-- The Deactivation clean-up now drops the person's Saved Threads and mutes too
-- (product.md › Deactivation, data-model.md › The clean-up routine). A redefinition of
-- 0011's function with two added deletes; grants and the pinned search_path carry over.
CREATE OR REPLACE FUNCTION public.deactivate_staff_member(target uuid)
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

    -- Their Pings, Saved Threads, mutes and Section placement go with their access
    -- (data-model.md › The clean-up routine). Reactivating them back-fills nothing.
    DELETE FROM public.ping p WHERE p.staff_id = target;
    DELETE FROM public.saved_thread st WHERE st.staff_id = target;
    DELETE FROM public.mute u WHERE u.staff_id = target;
    DELETE FROM public.section_channel sc WHERE sc.staff_id = target;

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
  $$;