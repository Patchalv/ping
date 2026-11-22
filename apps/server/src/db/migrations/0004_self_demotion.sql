-- An Admin who isn't the last active Admin can demote themself (permissions.md › Staff
-- members). Hand-written, like 0000.
--
-- ping_app may update only the columns the app changes (role, deactivated_at,
-- deactivated_by), so writing your own row can't touch joined_at or invited_by. On your
-- own row the new values must be: role member, still active, and another active Admin
-- left. So an Admin can't Deactivate themself, and the last active Admin can't demote
-- themself. The route also holds the staff-management lock, so two Admins demoting
-- themselves at once still leave one.
REVOKE UPDATE ON "staff_member" FROM ping_app;--> statement-breakpoint
GRANT UPDATE ("role", "deactivated_at", "deactivated_by") ON "staff_member" TO ping_app;--> statement-breakpoint

-- Policy helper: is there an active Admin other than the acting Staff member? SECURITY
-- DEFINER for the same reason as current_staff_is_admin. STABLE, so inside an UPDATE it
-- reads the rows as they were when the statement began.
CREATE FUNCTION public.another_active_admin_exists() RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = pg_catalog
  AS $$
    SELECT EXISTS (
      SELECT 1 FROM public.staff_member
      WHERE id <> public.current_staff_id()
        AND role = 'admin' AND joined_at IS NOT NULL AND deactivated_at IS NULL
    )
  $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.another_active_admin_exists() FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.another_active_admin_exists() TO ping_app;--> statement-breakpoint

DROP POLICY staff_member_update ON "staff_member";--> statement-breakpoint
CREATE POLICY staff_member_update ON "staff_member" FOR UPDATE TO ping_app
  USING ((SELECT public.current_staff_is_admin()))
  WITH CHECK (
    (SELECT public.current_staff_is_admin())
    AND (
      id <> (SELECT public.current_staff_id())
      OR (
        role = 'member' AND deactivated_at IS NULL AND deactivated_by IS NULL
        AND (SELECT public.another_active_admin_exists())
      )
    )
  );
