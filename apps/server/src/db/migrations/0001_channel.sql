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

-- Row-level security for Channels (permissions.md › Policies, ADR 0005). Hand-written,
-- like 0000.
--
-- Policy helpers: the Channels the acting Staff member is an active member of, and the
-- ones they are Channel admin of. Set-returning and SECURITY DEFINER, so a policy can ask
-- without querying channel_member under its own policy (which would raise "infinite
-- recursion detected in policy"). Policies call them as
-- `= ANY (ARRAY(SELECT public.current_staff_…()))`, which Postgres runs once per statement
-- as an InitPlan, never once per row. A Deactivated or unknown app.staff_id gets nothing.
CREATE FUNCTION public.current_staff_channel_ids() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT m.channel_id
      FROM public.channel_member m
      JOIN public.staff_member s ON s.id = m.staff_id
     WHERE m.staff_id = public.current_staff_id()
       AND s.deactivated_at IS NULL
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.current_staff_channel_ids() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.current_staff_channel_ids() TO ping_app, ping_system;--> statement-breakpoint

CREATE FUNCTION public.current_staff_admin_channel_ids() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT m.channel_id
      FROM public.channel_member m
      JOIN public.staff_member s ON s.id = m.staff_id
     WHERE m.staff_id = public.current_staff_id()
       AND m.is_channel_admin
       AND s.deactivated_at IS NULL
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.current_staff_admin_channel_ids() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.current_staff_admin_channel_ids() TO ping_app, ping_system;--> statement-breakpoint

-- channel: ping_app only reads, through the visibility rule, with no Admin exception: a
-- Channel is visible when it is Public or the acting Staff member is a member. Nothing
-- in the app writes a Channel directly; create_channel below is the only way to create
-- one. Channels are never deleted. (#42 adds a column-limited UPDATE for settings.)
GRANT SELECT ON "channel" TO ping_app;--> statement-breakpoint
ALTER TABLE "channel" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "channel" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY channel_select ON "channel" FOR SELECT TO ping_app
  USING (
    (SELECT public.current_staff_is_active())
    AND (visibility = 'public' OR id = ANY (ARRAY(SELECT public.current_staff_channel_ids())))
  );--> statement-breakpoint

-- channel_member: reads follow the visibility rule; writes have their own rules (ADR 0005).
-- Company Admins get no exception. The finer rules (the last Channel admin can't leave)
-- stay in the server's permissions module. The Public-channel check is uncorrelated, so it
-- too runs once per statement, and it reads channel through channel's own policy.
GRANT SELECT, INSERT, UPDATE, DELETE ON "channel_member" TO ping_app;--> statement-breakpoint
ALTER TABLE "channel_member" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "channel_member" FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Read: the row's Channel is Public, or the acting Staff member is a member of it.
CREATE POLICY channel_member_select ON "channel_member" FOR SELECT TO ping_app
  USING (
    channel_id = ANY (ARRAY(SELECT public.current_staff_channel_ids()))
    OR channel_id IN (SELECT c.id FROM public.channel c WHERE c.visibility = 'public')
  );--> statement-breakpoint

-- Insert: your own plain row in a Public channel (joining), or any row in a Channel you
-- are Channel admin of (adding members and Channel admins).
CREATE POLICY channel_member_insert ON "channel_member" FOR INSERT TO ping_app
  WITH CHECK (
    (
      staff_id = (SELECT public.current_staff_id())
      AND NOT is_channel_admin
      AND (SELECT public.current_staff_is_active())
      AND channel_id IN (SELECT c.id FROM public.channel c WHERE c.visibility = 'public')
    )
    OR channel_id = ANY (ARRAY(SELECT public.current_staff_admin_channel_ids()))
  );--> statement-breakpoint

-- Update (appointing or removing a Channel admin): Channel admins of that Channel only.
CREATE POLICY channel_member_update ON "channel_member" FOR UPDATE TO ping_app
  USING (channel_id = ANY (ARRAY(SELECT public.current_staff_admin_channel_ids())))
  WITH CHECK (channel_id = ANY (ARRAY(SELECT public.current_staff_admin_channel_ids())));--> statement-breakpoint

-- Delete: your own row (leaving), or any row in a Channel you are Channel admin of
-- (removing a member).
CREATE POLICY channel_member_delete ON "channel_member" FOR DELETE TO ping_app
  USING (
    (staff_id = (SELECT public.current_staff_id()) AND (SELECT public.current_staff_is_active()))
    OR channel_id = ANY (ARRAY(SELECT public.current_staff_admin_channel_ids()))
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
