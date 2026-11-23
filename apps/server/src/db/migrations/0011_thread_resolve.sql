-- Resolve and reopen (product.md › Resolve and reopen). ping_app may now set and clear a
-- Thread's resolved_at and resolved_by. Who may do it, per the Channel's "Who can resolve
-- threads?" setting, is the permissions module's job (permissions.md › Policies); the
-- thread_visible policy still limits the update to Threads the actor can read.
GRANT UPDATE (resolved_at, resolved_by) ON "thread" TO ping_app;
