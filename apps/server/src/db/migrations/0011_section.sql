CREATE TABLE "section" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"staff_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"collapsed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "section_id_staff_id_unique" UNIQUE("id","staff_id")
);
--> statement-breakpoint
CREATE TABLE "section_channel" (
	"staff_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"section_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "section_channel_staff_id_channel_id_pk" PRIMARY KEY("staff_id","channel_id")
);
--> statement-breakpoint
ALTER TABLE "section" ADD CONSTRAINT "section_staff_id_staff_member_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_channel" ADD CONSTRAINT "section_channel_staff_id_staff_member_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_channel" ADD CONSTRAINT "section_channel_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "section_channel" ADD CONSTRAINT "section_channel_section_fk" FOREIGN KEY ("section_id","staff_id") REFERENCES "public"."section"("id","staff_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "section_staff_id_position_idx" ON "section" USING btree ("staff_id","position");--> statement-breakpoint
CREATE INDEX "section_channel_section_id_idx" ON "section_channel" USING btree ("section_id");--> statement-breakpoint

-- Sidebar Sections (#44). Hand-written after the generated DDL, like 0007 to 0010.
--
-- Row-level security (permissions.md › Policies): every command on section and
-- section_channel reaches only the acting Staff member's own rows, while they're active.
-- Whether a Channel may be placed (membership) is the permissions module's job; the
-- composite foreign key keeps a placement in a Section of the same owner, because foreign
-- key checks bypass row-level security.
GRANT SELECT, INSERT, UPDATE, DELETE ON "section" TO ping_app;--> statement-breakpoint
ALTER TABLE "section" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "section" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY section_own ON "section" FOR ALL TO ping_app
  USING (staff_id = (SELECT public.current_staff_id()) AND (SELECT public.current_staff_is_active()))
  WITH CHECK (staff_id = (SELECT public.current_staff_id()) AND (SELECT public.current_staff_is_active()));--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "section_channel" TO ping_app;--> statement-breakpoint
ALTER TABLE "section_channel" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "section_channel" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY section_channel_own ON "section_channel" FOR ALL TO ping_app
  USING (staff_id = (SELECT public.current_staff_id()) AND (SELECT public.current_staff_is_active()))
  WITH CHECK (staff_id = (SELECT public.current_staff_id()) AND (SELECT public.current_staff_is_active()));--> statement-breakpoint

-- The losing-access clean-up now drops Section placement too (0010 named this slice). A
-- redefinition of 0010's function with one added step; grants and the pinned search_path
-- carry over.
--
-- Placement goes for everyone no longer in the Channel, Public or Private: the sidebar
-- lists only Channels you're a member of (data-model.md › The clean-up routine). Pings still
-- go only for a Private channel. It works from the Channel's current members, never from a
-- Staff member in an argument, so it can't touch anyone who is still in it. Returns how
-- many Pings it dropped, as before.
CREATE OR REPLACE FUNCTION public.clean_up_lost_access(target_channel_id uuid)
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

    DELETE FROM public.section_channel sc
     WHERE sc.channel_id = target_channel_id
       AND NOT EXISTS (
         SELECT 1 FROM public.channel_member m
          WHERE m.channel_id = target_channel_id AND m.staff_id = sc.staff_id
       );

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

-- The Deactivation clean-up now drops the person's Section placement too
-- (data-model.md › The clean-up routine). A redefinition of 0010's function with one added
-- step; their Sections themselves stay, empty. Grants and the pinned search_path carry over.
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

    -- Their Pings and Section placement go with their access (data-model.md › The clean-up
    -- routine). Reactivating them back-fills nothing.
    DELETE FROM public.ping p WHERE p.staff_id = target;
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
