CREATE TYPE "public"."channel_visibility" AS ENUM('public', 'private');--> statement-breakpoint
CREATE TYPE "public"."resolve_policy" AS ENUM('any_member', 'author_and_channel_admins');--> statement-breakpoint
CREATE TABLE "channel" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"visibility" "channel_visibility" NOT NULL,
	"resolve_policy" "resolve_policy" DEFAULT 'any_member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('english', name || ' ' || description)) STORED,
	CONSTRAINT "channel_archived_by_with_at" CHECK (("channel"."archived_at" is null) = ("channel"."archived_by" is null))
);
--> statement-breakpoint
CREATE TABLE "channel_member" (
	"channel_id" uuid NOT NULL,
	"staff_id" uuid NOT NULL,
	"is_channel_admin" boolean DEFAULT false NOT NULL,
	"joined_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "channel_member_channel_id_staff_id_pk" PRIMARY KEY("channel_id","staff_id")
);
--> statement-breakpoint
ALTER TABLE "channel" ADD CONSTRAINT "channel_created_by_staff_member_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel" ADD CONSTRAINT "channel_archived_by_staff_member_id_fk" FOREIGN KEY ("archived_by") REFERENCES "public"."staff_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_member" ADD CONSTRAINT "channel_member_channel_id_channel_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."channel"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_member" ADD CONSTRAINT "channel_member_staff_id_staff_member_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff_member"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "channel_search_idx" ON "channel" USING gin ("search");--> statement-breakpoint
CREATE INDEX "channel_member_staff_id_idx" ON "channel_member" USING btree ("staff_id");--> statement-breakpoint

-- Row-level security for Channels (permissions.md › Policies). Hand-written, like 0000.
--
-- Policy helper: is the acting Staff member an active member of this Channel? SECURITY
-- DEFINER, so policies can ask without querying channel_member under its own policy,
-- which would raise "infinite recursion detected in policy". Every visibility policy
-- uses it. A Deactivated or unknown app.staff_id is a member of nothing.
CREATE FUNCTION public.is_channel_member(target_channel_id uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT EXISTS (
      SELECT 1
        FROM public.channel_member m
        JOIN public.staff_member s ON s.id = m.staff_id
       WHERE m.channel_id = target_channel_id
         AND m.staff_id = public.current_staff_id()
         AND s.deactivated_at IS NULL
    )
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.is_channel_member(uuid) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.is_channel_member(uuid) TO ping_app, ping_system;--> statement-breakpoint

-- channel: the visibility rule, FOR ALL, with no Admin exception. A Channel is visible when
-- it is Public or the acting Staff member is a member. Channels are never deleted, so
-- ping_app has no DELETE grant. A plain insert of a Private channel fails the rule (its
-- creator isn't a member yet); create_channel below does that job.
GRANT SELECT, INSERT, UPDATE ON "channel" TO ping_app;--> statement-breakpoint
ALTER TABLE "channel" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "channel" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY channel_visibility ON "channel" FOR ALL TO ping_app
  USING ((SELECT public.current_staff_is_active()) AND (visibility = 'public' OR public.is_channel_member(id)))
  WITH CHECK ((SELECT public.current_staff_is_active()) AND (visibility = 'public' OR public.is_channel_member(id)));--> statement-breakpoint

-- channel_member: the same visibility rule, applied to the row's Channel. The Channel's
-- visibility is read through the channel policy, which itself only calls the helper, so
-- nothing recurses.
GRANT SELECT, INSERT, UPDATE, DELETE ON "channel_member" TO ping_app;--> statement-breakpoint
ALTER TABLE "channel_member" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "channel_member" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY channel_member_visibility ON "channel_member" FOR ALL TO ping_app
  USING (
    public.is_channel_member(channel_id)
    OR EXISTS (SELECT 1 FROM public.channel c WHERE c.id = channel_id AND c.visibility = 'public')
  )
  WITH CHECK (
    public.is_channel_member(channel_id)
    OR EXISTS (SELECT 1 FROM public.channel c WHERE c.id = channel_id AND c.visibility = 'public')
  );--> statement-breakpoint

-- System function (permissions.md › System functions): inserts a Channel and its first
-- Channel admin together, for the Staff member in app.staff_id. Called by the
-- system-actions module only, inside the request's own transaction, after the server has
-- authorised the request. Returns the new Channel's ID, or null (inserting nothing) when
-- app.staff_id is unset or isn't an active Staff member.
CREATE FUNCTION public.create_channel(
  channel_name text,
  channel_description text,
  channel_visibility public.channel_visibility
) RETURNS uuid
  LANGUAGE plpgsql VOLATILE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
  DECLARE
    actor uuid := public.current_staff_id();
    new_id uuid;
  BEGIN
    IF actor IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.staff_member WHERE id = actor AND deactivated_at IS NULL
    ) THEN
      RETURN NULL;
    END IF;
    INSERT INTO public.channel (name, description, visibility, created_by)
      VALUES (channel_name, channel_description, channel_visibility, actor)
      RETURNING id INTO new_id;
    INSERT INTO public.channel_member (channel_id, staff_id, is_channel_admin)
      VALUES (new_id, actor, true);
    RETURN new_id;
  END
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.create_channel(text, text, public.channel_visibility) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.create_channel(text, text, public.channel_visibility) TO ping_app;
