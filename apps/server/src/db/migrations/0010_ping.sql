CREATE TABLE "ping" (
	"staff_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"first_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ping_staff_id_thread_id_pk" PRIMARY KEY("staff_id","thread_id"),
	CONSTRAINT "ping_count_positive" CHECK ("ping"."count" >= 1)
);
--> statement-breakpoint
ALTER TABLE "ping" ADD CONSTRAINT "ping_staff_id_staff_member_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ping" ADD CONSTRAINT "ping_thread_fk" FOREIGN KEY ("thread_id","channel_id") REFERENCES "public"."thread"("id","channel_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ping_staff_id_last_at_idx" ON "ping" USING btree ("staff_id","last_at");
--> statement-breakpoint
-- Pings (#46). Hand-written after the generated DDL, like 0007 to 0009.
--
-- Row-level security: a Staff member reads and deletes only their own Pings, in Channels
-- they can read (the visibility rule, with no Admin exception), as an uncorrelated
-- = ANY (ARRAY(SELECT …)) so it runs once per statement. ping_app never inserts or
-- updates: other people's Pings are created and bumped by fan_out_pings, and Acknowledging
-- deletes.
GRANT SELECT, DELETE ON "ping" TO ping_app;--> statement-breakpoint
ALTER TABLE "ping" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ping" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY ping_own ON "ping" FOR ALL TO ping_app
  USING (
    staff_id = (SELECT public.current_staff_id())
    AND (SELECT public.current_staff_is_active())
    AND (
      channel_id = ANY (ARRAY(SELECT public.current_staff_channel_ids()))
      OR channel_id IN (SELECT c.id FROM public.channel c WHERE c.visibility = 'public')
    )
  );--> statement-breakpoint

-- System function (permissions.md › System functions): the Ping fan-out. Called by the
-- system-actions module only, inside the transaction of the post, after the server has
-- authorised it; if it raises or fails, the post rolls back with it.
--
-- It creates or bumps a Ping (count + 1, last_at now) for every active member of the
-- post's Channel except the acting Staff member. Mutes, Saved and Mentions join the rules
-- in later slices (#48, #49).
--
-- Its arguments can't steer it at anyone: it takes only the post, the Channel comes from
-- the Thread row and the recipients from the Channel's members. It acts only for an active
-- member of that Channel in app.staff_id, and only on a post they wrote in this very
-- transaction (created_at is the transaction's now()), so calling it again, or on someone
-- else's post, does nothing. Pass a Thread Response ID for a Thread Response, none for a
-- new Thread. Returns how many Pings it created or bumped.
CREATE FUNCTION public.fan_out_pings(target_thread_id uuid, target_response_id uuid DEFAULT NULL)
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
      SELECT m.staff_id, target_thread_id, target_channel
        FROM public.channel_member m
        JOIN public.staff_member s ON s.id = m.staff_id
       WHERE m.channel_id = target_channel
         AND m.staff_id <> actor
         AND s.joined_at IS NOT NULL
         AND s.deactivated_at IS NULL
      ON CONFLICT (staff_id, thread_id) DO UPDATE
        SET count = public.ping.count + 1, last_at = now();
    GET DIAGNOSTICS bumped = ROW_COUNT;
    RETURN bumped;
  END
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.fan_out_pings(uuid, uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.fan_out_pings(uuid, uuid) TO ping_app;--> statement-breakpoint

-- System function (permissions.md › System functions, data-model.md › The clean-up
-- routine): the losing-access clean-up. Called by the system-actions module only, inside
-- the transaction of the leave or removal, after the membership row is gone.
--
-- It drops the Pings, in the Channel, of everyone who can no longer read it: a Private
-- channel, and not a member. A Public channel drops nothing, so leaving it keeps Pings.
-- It works from the Channel's current state, never from a Staff member in an argument, so
-- it can't touch anyone who still has access. Saved Threads, mutes and Section placement
-- join it in later slices (#48, #44). It acts only for an active Staff member in
-- app.staff_id. Returns how many Pings it dropped.
CREATE FUNCTION public.clean_up_lost_access(target_channel_id uuid)
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    actor uuid := public.current_staff_id();
    dropped integer;
  BEGIN
    IF actor IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.staff_member WHERE id = actor AND deactivated_at IS NULL
    ) THEN
      RETURN 0;
    END IF;

    DELETE FROM public.ping p
     WHERE p.channel_id = target_channel_id
       AND EXISTS (
         SELECT 1 FROM public.channel c WHERE c.id = target_channel_id AND c.visibility = 'private'
       )
       AND NOT EXISTS (
         SELECT 1 FROM public.channel_member m
          WHERE m.channel_id = target_channel_id AND m.staff_id = p.staff_id
       );
    GET DIAGNOSTICS dropped = ROW_COUNT;
    RETURN dropped;
  END
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.clean_up_lost_access(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.clean_up_lost_access(uuid) TO ping_app;--> statement-breakpoint

-- The Deactivation clean-up now drops the person's Pings too (0003 named this slice). A
-- redefinition of 0003's function with one added step; grants and the pinned search_path
-- carry over.
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

    -- Their Pings go with their access (data-model.md › The clean-up routine). Reactivating
    -- them back-fills nothing.
    DELETE FROM public.ping p WHERE p.staff_id = target;

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
