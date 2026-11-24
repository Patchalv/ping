CREATE TABLE "mention" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"channel_id" uuid NOT NULL,
	"thread_id" uuid,
	"thread_response_id" uuid,
	"staff_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mention_exactly_one_target" CHECK (("mention"."thread_id" is not null) <> ("mention"."thread_response_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "mention" ADD CONSTRAINT "mention_staff_id_staff_member_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mention" ADD CONSTRAINT "mention_thread_fk" FOREIGN KEY ("thread_id","channel_id") REFERENCES "public"."thread"("id","channel_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mention" ADD CONSTRAINT "mention_thread_response_fk" FOREIGN KEY ("thread_response_id","channel_id") REFERENCES "public"."thread_response"("id","channel_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mention_thread_staff_unique" ON "mention" USING btree ("thread_id","staff_id") WHERE "mention"."thread_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "mention_thread_response_staff_unique" ON "mention" USING btree ("thread_response_id","staff_id") WHERE "mention"."thread_response_id" is not null;--> statement-breakpoint
CREATE INDEX "mention_staff_id_idx" ON "mention" USING btree ("staff_id");--> statement-breakpoint

-- Mentions (#49). Hand-written after the generated DDL, like 0007 to 0013.
--
-- Row-level security: the visibility rule, FOR ALL, with no Admin exception, the same as
-- thread's. Two restrictive policies narrow writes. A Mention is written, and removed, only
-- on a post the actor may edit: their own, or any as a company Admin (who edits in Channels
-- they can read). And only someone who can read the Thread can be Mentioned: an active
-- Staff member who has joined, and a Channel member if the Channel is Private. Mentioning a
-- non-member of a Public channel doesn't make them join. The permissions module checks the
-- same first and answers with a message; this is belt and braces.
--
-- ping_app never updates a Mention: the rows are rebuilt from the body on every save, by
-- inserting the newly Mentioned and deleting the rest.
GRANT SELECT, INSERT, DELETE ON "mention" TO ping_app;--> statement-breakpoint
ALTER TABLE "mention" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "mention" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY mention_visible ON "mention" FOR ALL TO ping_app
  USING (
    (SELECT public.current_staff_is_active())
    AND (
      channel_id = ANY (ARRAY(SELECT public.current_staff_channel_ids()))
      OR channel_id IN (SELECT c.id FROM public.channel c WHERE c.visibility = 'public')
    )
  );--> statement-breakpoint
CREATE POLICY mention_insert_on_editable_post ON "mention" AS RESTRICTIVE FOR INSERT TO ping_app
  WITH CHECK (
    (SELECT public.current_staff_is_admin())
    OR thread_id IN (
      SELECT t.id FROM public.thread t WHERE t.author_id = (SELECT public.current_staff_id()))
    OR thread_response_id IN (
      SELECT r.id FROM public.thread_response r
       WHERE r.author_id = (SELECT public.current_staff_id()))
  );--> statement-breakpoint
CREATE POLICY mention_delete_on_editable_post ON "mention" AS RESTRICTIVE FOR DELETE TO ping_app
  USING (
    (SELECT public.current_staff_is_admin())
    OR thread_id IN (
      SELECT t.id FROM public.thread t WHERE t.author_id = (SELECT public.current_staff_id()))
    OR thread_response_id IN (
      SELECT r.id FROM public.thread_response r
       WHERE r.author_id = (SELECT public.current_staff_id()))
  );--> statement-breakpoint
CREATE POLICY mention_insert_readable_staff ON "mention" AS RESTRICTIVE FOR INSERT TO ping_app
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.staff_member s
       WHERE s.id = staff_id AND s.joined_at IS NOT NULL AND s.deactivated_at IS NULL
    )
    AND (
      channel_id IN (SELECT c.id FROM public.channel c WHERE c.visibility = 'public')
      OR EXISTS (
        SELECT 1 FROM public.channel_member m
         WHERE m.channel_id = mention.channel_id AND m.staff_id = mention.staff_id
      )
    )
  );--> statement-breakpoint

-- The Ping fan-out now covers Mentions (product.md › Who gets a Ping). A redefinition of
-- 0013's function; grants and the pinned search_path carry over.
--
-- It Pings the Mention rows of the post created in this very transaction: the people this
-- save newly Mentioned, as the server rebuilt the rows from the body. A Mention Pings
-- whatever the person's mutes, so its branch of the UNION sits outside the mute filter,
-- and someone who is a member, has Saved the Thread and is Mentioned still gets one Ping,
-- not three. It Pings only Mentioned people who can still read the Thread: active, joined,
-- and a member if the Channel is Private.
--
-- A new Thread or Thread Response (by the actor, created now, in a Channel they're a
-- member of) Pings as 0013 did (other members, mutes and Saved as there) plus the newly
-- Mentioned. An edit (by the actor, edited now, in a Channel they can read; a company Admin
-- may edit where they aren't a member) Pings only the newly Mentioned: edits Ping no
-- members and no one who Saved the Thread. Its arguments still can't steer it at anyone:
-- the recipients come from the Channel's members, Saved Threads and Mention rows that
-- row-level security let the actor write.
CREATE OR REPLACE FUNCTION public.fan_out_pings(target_thread_id uuid, target_response_id uuid DEFAULT NULL)
  RETURNS integer
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    actor uuid := public.current_staff_id();
    target_channel uuid;
    is_new boolean;
    target_public boolean;
    bumped integer;
  BEGIN
    IF actor IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.staff_member WHERE id = actor AND deactivated_at IS NULL
    ) THEN
      RETURN 0;
    END IF;

    IF target_response_id IS NULL THEN
      SELECT t.channel_id, t.created_at = now() INTO target_channel, is_new
        FROM public.thread t
       WHERE t.id = target_thread_id
         AND (
           (t.author_id = actor AND t.created_at = now())
           OR (t.edited_by = actor AND t.edited_at = now())
         );
    ELSE
      SELECT r.channel_id, r.created_at = now() INTO target_channel, is_new
        FROM public.thread_response r
       WHERE r.id = target_response_id AND r.thread_id = target_thread_id
         AND r.deleted_at IS NULL
         AND (
           (r.author_id = actor AND r.created_at = now())
           OR (r.edited_by = actor AND r.edited_at = now())
         );
    END IF;
    IF target_channel IS NULL THEN
      RETURN 0;
    END IF;

    SELECT c.visibility = 'public' INTO target_public
      FROM public.channel c WHERE c.id = target_channel;
    IF NOT EXISTS (
      SELECT 1 FROM public.channel_member m
       WHERE m.channel_id = target_channel AND m.staff_id = actor
    ) AND (is_new OR NOT target_public) THEN
      RETURN 0;
    END IF;

    INSERT INTO public.ping (staff_id, thread_id, channel_id)
      SELECT recipient.staff_id, target_thread_id, target_channel
        FROM (
          -- New posts: the Channel's members, less those who muted it for a Thread Response.
          SELECT m.staff_id
            FROM public.channel_member m
           WHERE is_new
             AND m.channel_id = target_channel
             AND (
               target_response_id IS NULL
               OR NOT EXISTS (
                 SELECT 1 FROM public.mute u
                  WHERE u.staff_id = m.staff_id AND u.channel_id = target_channel
                    AND (u.thread_id IS NULL OR u.thread_id = target_thread_id)
               )
             )
          UNION
          -- New Thread Responses: whoever Saved the Thread and can still read it.
          SELECT st.staff_id
            FROM public.saved_thread st
           WHERE is_new
             AND target_response_id IS NOT NULL
             AND st.thread_id = target_thread_id
             AND (
               target_public
               OR EXISTS (
                 SELECT 1 FROM public.channel_member m
                  WHERE m.channel_id = target_channel AND m.staff_id = st.staff_id
               )
             )
          UNION
          -- New posts and edits: the newly Mentioned, mutes ignored.
          SELECT n.staff_id
            FROM public.mention n
           WHERE (
               (target_response_id IS NULL AND n.thread_id = target_thread_id)
               OR n.thread_response_id = target_response_id
             )
             AND n.created_at = now()
             AND (
               target_public
               OR EXISTS (
                 SELECT 1 FROM public.channel_member m
                  WHERE m.channel_id = target_channel AND m.staff_id = n.staff_id
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
  $$;
