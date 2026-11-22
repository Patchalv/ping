# Channel membership writes are guarded in the database, not only in the server

**Status:** accepted

ADR 0004 makes row-level security a backstop for reads: the visibility rule, applied to every Channel-scoped table, and write rules left to the server's permissions module. For `channel_member` that wasn't enough. Under the plain visibility rule, any active Staff member could, with raw SQL, add themself as Channel admin of any Public channel or remove other members from it. A Channel admin can see and manage everything in their Channel, so a buggy query there hands out access. That is the failure this product most has to avoid.

## Decision

- **`channel` is read-only for `ping_app`.** It has a SELECT grant and a SELECT policy (the visibility rule) and nothing else. The `create_channel` system function is the only way to create a Channel, so none can exist without a Channel admin or with a made-up `created_by`. Channels are never deleted. The settings slice (#42) adds an UPDATE limited to the columns it changes.
- **`channel_member` has a policy per command:**
  - **Select:** the visibility rule.
  - **Insert:** your own row, not as Channel admin, in a Public channel (joining); or any row in a Channel you are Channel admin of (adding members and Channel admins).
  - **Update:** Channel admins of that Channel only.
  - **Delete:** your own row (leaving); or any row in a Channel you are Channel admin of (removing a member).
- **No Admin exception**, as everywhere else. A company Admin who may appoint Channel admins of a Public channel does it through a system function when that slice arrives, not through a policy exception.
- **The finer rules stay in the server.** "The last active Channel admin can't leave" and "Archived channels refuse changes" need context a policy shouldn't carry.
- **Set-returning helpers.** The policies call `current_staff_channel_ids()` and `current_staff_admin_channel_ids()`, both `SECURITY DEFINER` with a pinned `search_path`, as `channel_id = ANY (ARRAY(SELECT …))`. Postgres evaluates them once per statement, as an InitPlan, rather than once per row; a test reads the query plan to prove it. They also avoid the recursion a policy on `channel_member` would hit by querying `channel_member`.
- **Other Channel-scoped tables keep the plain visibility rule.** Who may edit or delete a Thread is the permissions module's call, as before.

## Amendment: `joined_at` and the leave lock (#36)

- **Nobody chooses `joined_at`.** It decides who is auto-promoted when a sole Channel admin is Deactivated, so a backdated row would win. Every insert's `joined_at` must equal `now()`, the transaction's start time and the column default, in the insert policy's `WITH CHECK`. A policy can't compare old and new values on UPDATE, so `ping_app` may update only `is_channel_admin` (a column grant), as 0004 does for `staff_member`. We chose the policy check over a column-level INSERT grant because an insert that names `joined_at` as `DEFAULT` counts as writing it, and a grant would refuse it.
- **Changes that could remove the last Channel admin take a per-Channel lock first** (`pg_advisory_xact_lock` on the Channel ID, in `lockChannelMembership`), then read who is Channel admin. Without it, two Channel admins leaving at once each see the other staying. `ping_app` can't `SELECT … FOR UPDATE` on `channel`, which is SELECT only. Removing members and Channel admin roles (#37) reuses the lock.

## Considered options

- **The plain visibility rule on `channel_member`, with write rules only in the server:** rejected, for the raw-SQL escalation above.
- **A per-row helper, `is_channel_member(channel_id)`:** rejected. It's fine for Channels but costs one lookup per row on Threads, Thread Responses and search, which copy the pattern.
- **Every membership write through a system function:** not chosen. Joining, leaving and Channel-admin changes are ordinary requests by the person acting; policies express them directly, and the functions would only repeat them.
