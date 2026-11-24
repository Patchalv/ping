# Permissions

Permissions are enforced twice ([ADR 0002](../adr/0002-two-layer-permissions.md)):

1. **The server.** Every request is authorised by one thoroughly tested permissions module before it touches data.
2. **The database.** Postgres row-level security is a backstop, so even a buggy query can't return rows the Staff member may not see.

The front end only hides controls it knows will be refused. It is never trusted. A leaked Private channel is the worst failure Ping can have.

## Server layer: who can do what

Terms used below:

- **Can read a Channel** means the Channel is Public, or you're a member of it. This is the same for everyone, Admins included.
- **Member** means an active Channel member. **Channel admin** means an active Channel member with the Channel admin role. **Admin** means a company Admin.
- Deactivated and Invited Staff members can't sign in, so they can do nothing.
- In an **Archived channel**, only the actions marked ✱ are allowed. The rest are refused until it's unarchived.

### Staff members

| Action | Who |
| --- | --- |
| Invite, Resend, Cancel an invite | Admin |
| Change a Staff member's role | Admin (not the last active Admin demoting themself) |
| Change own email | Anyone, for themself, confirmed through a link sent to the new address |
| Change someone else's email | Nobody |
| Deactivate, reactivate | Admin (not the last active Admin Deactivating themself) |
| Change own display name | Anyone, for themself |
| See Invited Staff members | Admin |
| See active and Deactivated Staff members | Anyone |

### Channels

| Action | Who |
| --- | --- |
| Create a Channel | Anyone (becomes its Channel admin) |
| Find and read a Channel ✱ | Anyone who can read it |
| Edit name, description, "Who can resolve threads?" | Channel admin |
| Turn a Public channel Private | Channel admin |
| Make a Private channel Public | Nobody |
| Archive, unarchive ✱ (unarchive) | Channel admin; Admin on a Public channel or a Private channel they're a member of |
| Join | Anyone, Public channels only |
| Add members | Any member (Public); Channel admin (Private) |
| Remove members | Channel admin |
| Appoint or remove a Channel admin | Channel admin; Admin on a Public channel, for anyone including themself |
| Leave ✱ | Any member, except the last active Channel admin |
| Delete a Channel | Nobody |

### Threads, Thread Responses and Attachments

| Action | Who |
| --- | --- |
| Start a Thread | Member |
| Send a Thread Response, react | Member |
| Mention someone | Whoever is posting; only Staff members who can read the Thread can be Mentioned |
| Edit a Thread or Thread Response | Its author; Admin in a Channel they can read |
| Delete a Thread or Thread Response ✱ (Admin only) | Its author; Admin in a Channel they can read |
| Resolve, reopen | Any member, or only the author and Channel admins, per the Channel's setting |
| Upload an Attachment | Whoever is posting, within the fixed limits |
| Download an Attachment ✱ | Anyone who can read the Thread |
| Remove an Attachment ✱ | Its uploader; Channel admin of that Channel; Admin in a Channel they can read |
| Respond as a System thread's author | Nobody |

### Personal

| Action | Who |
| --- | --- |
| Acknowledge (mark read, Save) ✱ | Anyone who can read the Thread |
| Acknowledge by reacting or responding | Member (see above) |
| Remove a Thread from Saved ✱ | Its owner |
| Mute a Channel ✱ | Member |
| Mute a Thread ✱ | Anyone who can read it |
| Sections | Their owner only |
| Search | Anyone; results limited to what they can read |

### Refusals

- A Private channel the Staff member can't read, and everything in it, answers **404**, so its existence doesn't leak.
- Other refusals answer 403 with a message the UI can show (for example, why the last Channel admin can't leave).

Sources: [Who can do what in a Channel?](https://github.com/Patchalv/ping/issues/6), [What happens to a Deactivated Staff member's Channels and Threads?](https://github.com/Patchalv/ping/issues/5), [Are attachments in the MVP?](https://github.com/Patchalv/ping/issues/4), [How do the first Admins get in, and how do invite and reset emails arrive?](https://github.com/Patchalv/ping/issues/15#issuecomment-6863586131), and the decisions made while writing this spec.

## Database layer: row-level security

How the backstop works is recorded in [ADR 0004](../adr/0004-rls-roles-and-staff-member-table.md).

### Roles

- **`neondb_owner`** runs migrations, from GitHub Actions only. On Neon it belongs to `neon_superuser` and bypasses RLS, so the app never connects as it.
- **`ping_app`** is the app's request role. It connects through Neon's pooler, is created in SQL, and owns no tables.
- **`ping_system`** has its own small pool and does only the work that has no signed-in Staff member behind it:
  - invite acceptance and `bootstrap-admin`;
  - the sweepers: file deletion, pending uploads, and `audit_event` retention.

  Policies allow `ping_system` explicitly (`TO ping_system USING (true)`), so it needs no BYPASSRLS attribute.

### System functions

Some ordinary requests must touch rows the acting Staff member can't. Those steps are `SECURITY DEFINER` functions, owned by the table owner and called by `ping_app` inside the request's own transaction. The step and the action that caused it commit or roll back together, which two database connections could never do.

- **`fan_out_pings`** creates or bumps other people's Pings for a new Thread, Thread Response or Mention.
- **`clean_up_lost_access`** drops other people's Ping, Saved, mute and Section rows when they leave or are removed from a Channel, or when a Channel turns Private (see [data-model.md](data-model.md#the-clean-up-routine)).
- **`deactivate_staff_member`** runs the Deactivation clean-up, promotes a replacement sole Channel admin, archives Channels left with no active members and starts their System threads, including in Private channels the Admin can't see.
- **`create_channel`** inserts a Channel and its first Channel admin together.
- **`make_channel_private`** turns a Public channel Private for one of its Channel admins, starts its System thread and Pings the Channel's other active members for it. Nothing makes a Channel Public.
- **`admin_set_channel_admin`** lets a company Admin appoint anyone, themself included, as Channel admin of a Public channel (adding them if they aren't a member), or remove the role, never leaving the Channel without an active Channel admin.

Rules for every system function:

- It reads the acting Staff member from `app.staff_id`, never from an argument.
- It pins its `search_path`.
- It does one fixed job. The server has already authorised the request, so the function isn't a second permissions module.
- Only the system-actions module calls it. The same module is the only user of the `ping_system` pool.

The exact function names can change in the build. The list of jobs can't grow without a **Permission changes** note in the PR (see [testing.md](testing.md#rules-for-agents)). Recorded in the second amendment to [ADR 0004](../adr/0004-rls-roles-and-staff-member-table.md).

### Identity per request

- Every request runs in one transaction that begins with `set_config('app.staff_id', <id>, true)`. The setting is local to the transaction, which is safe with PgBouncer's transaction mode. A plain `SET` is not.
- Policies return nothing when `app.staff_id` is unset, so a forgotten wrapper fails closed.
- No transaction ever stays open on a long-lived live-update stream.

### Policies

Every one of Ping's tables has RLS enabled and forced, with an explicit policy. The only tables without RLS are Better Auth's (`user`, `session`, `account`, `verification`).

| Table | `ping_app` policy |
| --- | --- |
| `channel` | **The visibility rule**, read only: a Channel is visible when it is Public or the current Staff member is a member of it. No Admin exception. `ping_app` has no INSERT or DELETE grant: `create_channel` is the only way to create one, and Channels are never deleted. Update: a Channel's active Channel admins, on `name`, `description` and `resolve_policy` only. `visibility` changes only through `make_channel_private`, so nothing makes a Channel Public. |
| `thread`, `thread_response`, `reaction`, `mention`, `attachment` (once attached) | **The visibility rule:** a row is visible when its Channel is Public or the current Staff member is a member of it. No Admin exception. Applied `FOR ALL`. |
| `channel_member` | Read: the visibility rule. Insert: a plain row (not Channel admin) in a Public channel, for yourself (joining) or, as an active member, for anyone (adding people); or any row in a Channel you are Channel admin of. Every insert's `joined_at` must be the transaction's time (its default). Update: Channel admins of that Channel only, and `ping_app` may update only `is_channel_admin`, so nobody backdates a `joined_at` to win auto-promotion. Delete: your own row (leaving), or any row in a Channel you are Channel admin of. No Admin exception: a company Admin appoints or removes Channel admins of a Public channel through `admin_set_channel_admin`. The finer rules, such as the last Channel admin not leaving or losing the role (the server takes a per-Channel lock first, so two Channel admins acting at once can't both go), stay in the permissions module ([ADR 0005](../adr/0005-channel-membership-write-policy.md)). |
| `attachment` while pending | Its uploader only. `ping_system` reads and deletes pending ones only (the pending-upload sweeper). |
| `attachment` removal | Update `removed_at` and `removed_by` only: its uploader, the Channel's admins or a company Admin, in a Channel they can read, on an attached Attachment not yet removed. A restrictive policy records a removal only in the acting Staff member's name, and a trigger stops an attached Attachment moving to another post. |
| `ping` | Read and delete: the owner's own rows in Channels they can read. Insert and update: none (only the fan-out function). |
| `saved_thread`, `mute` | Read, insert and delete: the owner's own rows in Channels they can read. Update: none. Clean-up of other people's rows runs through the clean-up function. |
| `section`, `section_channel` | Every command: the owner's own rows only. |
| `staff_member` | Read: every signed-in Staff member. Insert and update: an Admin only. The policy checks the current Staff member's `role` through a helper function, because a `staff_member` policy that queried `staff_member` directly would recurse, like `channel_member`. Delete: an Admin, for an Invited person only. On their own row an Admin may only demote themself to Member, and only while another active Admin is left, so nobody promotes or Deactivates themself and Spark always keeps an Admin. `ping_app` may update only `role`, `deactivated_at` and `deactivated_by`. |
| `staff_invite` | Every command: Admins only. Accepting an invite runs as `ping_system`. |
| `pending_file_deletion` | Insert only, of an Attachment's file the Staff member can see. Only `ping_system` reads, updates and deletes (the file-deletion sweeper), and it also inserts (the pending-upload sweeper). |
| `audit_event` | Insert only. Nothing reads it through the app. |

Search runs through the same policies.

The visibility rule guards reads, which is what the backstop is for. Most write rules (who may edit, delete or resolve) live only in the server's permissions module. Four writes are guarded in the database too: creating a Channel goes through `create_channel` (`channel` is read-only for `ping_app`), and membership writes have their own `channel_member` policies, so nobody can make themself Channel admin or remove others with raw SQL, because a mistake there would hand out access. And a Thread inserted through `ping_app` must be an ordinary one by the acting Staff member (a restrictive `thread_insert_as_self` policy), so nobody posts in someone else's name or as Ping. System threads are started by system functions only. And removing an Attachment is limited to its uploader, the Channel's admins and company Admins, in the acting Staff member's name (`attachment_remove` and the restrictive `attachment_removal_as_self`), because removal deletes the file for real.

Policies never ask "is the current Staff member a member of this row's Channel?" once per row. They call set-returning helpers (`current_staff_channel_ids()`, `current_staff_admin_channel_ids()`) as `channel_id = ANY (ARRAY(SELECT …))`, which Postgres runs once per statement. Threads, Thread Responses and search copy this. A test reads the query plan to prove it.

### Belt and braces

- `FORCE ROW LEVEL SECURITY` is added in raw SQL, because Drizzle doesn't emit it.
- CI fails if `ping_app` or `ping_system` can bypass RLS, owns a table, or if any table outside the Better Auth allowlist lacks forced RLS or a policy (see [testing.md](testing.md#rls-as-its-own-layer)).
- CI also fails if any `SECURITY DEFINER` function is missing from an explicit allowlist or has no pinned `search_path`.
- Neon doesn't document that `set_config(..., true)` works through its pooler. The foundation slice [Staging and prod deploy pipeline](https://github.com/Patchalv/ping/issues/30) proves it (see [testing.md](testing.md#what-the-foundation-slices-owe)).

Sources: [What is Ping's data model?](https://github.com/Patchalv/ping/issues/11#issuecomment-6861774289), and the [addendum on tables outside the visibility rule](https://github.com/Patchalv/ping/issues/16#issuecomment-6863848373).
