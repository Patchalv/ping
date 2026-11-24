# Testing

How Ping is tested, with the commands that run each suite. The strategy behind it is in [docs/spec/testing.md](spec/testing.md), and the rules both permission layers follow are in [docs/spec/permissions.md](spec/permissions.md).

## Before you run anything

The integration and Playwright suites need the local stack:

```bash
pnpm db:up
```

That starts Postgres 18, PgBouncer (port 6432), the pooler-test PgBouncer (port 6433, `default_pool_size=1`) and MinIO. Unit tests don't need it.

## Commands

| Command | Runs | Needs the stack |
| --- | --- | --- |
| `pnpm test` | Unit tests: pure logic, plus the route-coverage guard. | No |
| `pnpm test:int` | Integration tests: the RLS suite, the catalog guard, the permission matrix, sign-in, `withStaffTx`, the PgBouncer test, the pooler smoke check and the seed. | Yes |
| `pnpm test:e2e` | Playwright against the built app, at laptop and phone size. | Yes |
| `pnpm test:related <files>` | The unit and integration tests that touch those files. | For integration tests |
| `pnpm check` | Every check CI runs except `pnpm audit` and Playwright. | Yes |
| `pnpm db:seed` | Migrates the local database and loads the fake Staff members. | Yes |

Run one file with `pnpm exec vitest run <path>`.

## The suites

### Unit tests (`*.test.ts`)

Pure logic only, with no database: permission decisions, validators, text extraction, who gets a Ping, and the front end's pure helpers. Anything that touches SQL is an integration test. There are no React component tests.

### Integration tests (`*.int.test.ts`)

They run against the `docker compose` Postgres:

- `globalSetup` (`apps/server/src/test/global-setup.ts`) drops this checkout's old test databases, then runs the migrations once, as the owner, into a template database with the real `ping_app` and `ping_system` roles and policies.
- Each Vitest worker clones the template (`CREATE DATABASE … TEMPLATE`) in `apps/server/src/test/worker-setup.ts`.
- Database names start with a hash of the checkout's path, so worktrees sharing the stack never collide.
- Each test seeds its own fixtures with fresh UUIDs and never cleans up. Nothing is wrapped in a rollback, because the code under test opens its own transactions.

The plumbing is in `apps/server/src/db/test-support.ts`, because only `db/` may open a raw connection. Use `createStaffMember()` for fixtures and `asOwner()` to set up or inspect rows behind row-level security.

### The RLS suite (`apps/server/src/test/rls/`)

It connects as `ping_app` with no server code involved, sets `app.staff_id`, and runs raw SQL:

```ts
await asPingApp(member.id, async (query) => {
  const result = await query(`update staff_member set role = 'admin' where id = $1`, [member.id]);
  expect(result.rowCount).toBe(0);
});
```

Pass `null` instead of an ID to test failing closed. Each case runs in one transaction that is rolled back. Every new table needs cases for SELECT, INSERT, UPDATE and DELETE, plus failing closed. Every system function needs cases proving it acts for `app.staff_id`, does nothing when it's unset, and can't be steered through its arguments.

A policy that checks membership must run its helper once per statement. `channel.int.test.ts` shows how to prove it: run `explain (analyze, verbose, format json)` as `ping_app` over several rows, and check that the helper appears only inside an InitPlan with one loop, never in the scan's per-row filter.

### The catalog guard (`apps/server/src/test/catalog-guard.int.test.ts`)

It reads `pg_catalog` and fails if:

- `ping_app` or `ping_system` is a superuser, has BYPASSRLS, is a member of another role, or owns a table;
- a table in `public` outside Better Auth's (`user`, `session`, `account`, `verification`) lacks row-level security, `FORCE ROW LEVEL SECURITY` or a policy;
- a `SECURITY DEFINER` function is missing from the allowlist or has no pinned `search_path`.

The allowlists are in `apps/server/src/test/catalog.ts`.

### The permission matrix (`apps/server/src/test/permission-matrix/`)

Table-driven actor × Channel × action rows, run through the real Hono app in-process (`app.request`) against the real database. Add rows to `MATRIX` in `matrix.ts`:

```ts
{
  route: 'POST /api/channels',
  action: 'create a Private channel',
  actor: 'nonMemberMember',
  channel: null,
  request: () => ({ path: '/api/channels', method: 'POST', body: { name: 'Ops', visibility: 'private' } }),
  expect: { allow: true, status: 201 },
}
```

- The standard actors are in `actors.ts`. Each is a real Staff member signed in through Better Auth. The Deactivated actor replays a cookie from before their Deactivation.
- Deny rows assert the status and that the database is unchanged: every table's rows are checksummed before and after.
- Rows with a Channel use the Channel fixtures in `run-row.ts`. Each row gets a fresh Channel of its `channel` kind (`public`, `private`, `archived`, which is Public, or `archivedPrivate`, used by the archive and unarchive rows), and `CHANNEL_ROLE` in `actors.ts` sets each actor's place in it: Channel admin, member, or not a member.
- A row with `thread: true` also gets a Thread in its Channel, started by the `author` actor (or, for any other actor, by another member), passed to `request` as `ctx.thread`.
- Every new or changed endpoint needs at least one allow row, plus a deny row for every standard actor who shouldn't pass.

### The route-coverage guard (`apps/server/src/test/route-coverage.test.ts`)

It lists every registered Hono route and fails if one has neither a matrix row nor an allowlist entry. The allowlist, in `route-coverage.ts`, holds `/healthz`, Better Auth's routes, the security headers and the built SPA (`ALL /*` for the headers and the SPA's files, `GET /*` for client-side routes); invite accept (`POST /api/invites/lookup` and `POST /api/invites/accept`, tested directly in `features/staff/accept-routes.int.test.ts`) is on it too, and so is confirming an email change (`POST /api/email-change/confirm`, tested directly in `features/staff/profile-routes.int.test.ts`), whose link may be opened signed out. Better Auth's own `/update-user`, `/change-email`, `/verify-email` and `/send-verification-email` are switched off (`disabledPaths`), so Ping's routes are the only way to change a name or email. Password reset needs no entry of its own: it is Better Auth's `/api/auth/request-password-reset` and `/api/auth/reset-password`, tested directly in `auth/password-reset.int.test.ts`. Hono records `app.use` middleware and `app.all` handlers the same way, with method `ALL`, so every `ALL` entry must be allowlisted: register real handlers on a specific method, with matrix rows.

### The publish-coverage check (`apps/server/src/test/publish-coverage.int.test.ts`)

It runs every mutating route's permission-matrix allow rows (POST, PUT, PATCH, DELETE) while watching the live-update hub, and fails if a route never called `publish()`. The exemptions, with their reasons, are in `publish-coverage.ts`: Better Auth's routes, invite lookup, and changing your email (the change publishes when its link is opened). Invite accept and email-change confirm sit outside the matrix, so their own tests assert they publish. Changing the exemptions weakens the check: list it under **Permission changes**.

### Live updates (`apps/server/src/lib/sse/`)

`hub.test.ts` unit-tests the in-memory hub with fake timers: per-client order, resuming with `Last-Event-ID`, resync, heartbeats. `routes.int.test.ts` reads `GET /api/live` through the real app. To prove an event never arrives, publish it, then a sentinel the Staff member can receive, and read until the sentinel: each stream keeps its order.

### The PgBouncer test (`apps/server/src/db/pgbouncer.int.test.ts`)

It runs `withStaffTx` through PgBouncer in transaction mode with `default_pool_size=1`, proves every request landed on the same backend, and proves request B never sees request A's `app.staff_id`.

### The pooler smoke check (`apps/server/src/db/pooler-smoke.ts`)

After every staging deploy, `deploy.yml` runs `src/db/cli/pooler-smoke.ts` inside the staging Machine, through Neon's real pooler as `ping_app`. Four connections run transactions that each set their own `app.staff_id`, one after another and then all at once. It fails if any transaction sees another's `app.staff_id`, or any read outside a transaction sees one. Neon's pool size can't be forced to 1, so it also fails as inconclusive if no backend ever served two of the connections. `pooler-smoke.int.test.ts` runs the same check against the local PgBouncer, and shows it is inconclusive on direct connections. To run it by hand against any database:

```bash
DATABASE_URL='<url>' pnpm --filter @ping/server exec tsx src/db/cli/pooler-smoke.ts
```

### Playwright (`e2e/`)

The smoke suite builds the app, recreates and seeds a `ping_e2e` database, starts the production server on port 3100, and runs each journey at laptop and phone size. Today it covers signing in, a wrong password, a Deactivated Staff member, signing out, creating a Channel, opening a Private channel as a member, a Private channel staying absent (sidebar and URL) for a non-member Member and a non-member company Admin, nothing cached reaching the next person to sign in on the same browser, a lost session returning to sign-in, a failed network call, an empty sign-in, starting a Thread with formatting and reading it in its panel, Join in place of New Thread for a non-member, sending, editing ("edited") and deleting a Thread Response (its placeholder), editing a Thread, a company Admin's edit reading "edited by <name>", deleting a Thread after a confirmation that counts other people's Thread Responses, form mistakes (found by the schema or by the server) shown on their field, focused, and cleared when fixed, and a second Staff member receiving a Ping over the live-update stream, with Acknowledging clearing it. Shared helpers are in `e2e/support.ts`. Change it only when a slice changes one of the smoke journeys.

Locally nothing sets `Fly-Client-IP`, so Better Auth's sign-in rate limiter would put every test in one bucket. Each test sends its own address.

## Seeded Staff members

`pnpm db:seed` loads fake Spark Staff members. They all use the password `ping-local-dev-password`, which is also in `.env.example` and `apps/server/src/db/seed.ts`.

| Email | Role |
| --- | --- |
| `marta.ruiz@example.com` | Admin |
| `jordi.puig@example.com` | Member |
| `laura.gomez@example.com` | Member |
| `pablo.serra@example.com` | Member |
| `carlos.vidal@example.com` | Deactivated (sign-in is refused) |

It also loads three Channels: **Front desk** (Public; Marta, Jordi, Laura and Pablo), **Teaching** (Public; Laura and Jordi) and **Owners** (Private; Jordi and Laura). Opening Owners as Marta or Pablo answers 404.

## Rules for every slice

- Tests come first, red then green, with the `tdd` skill.
- Ship matrix rows for every new or changed endpoint, RLS cases for every new table, and unit tests for new pure logic.
- Never weaken a guard. Unless the issue says so, don't change an existing matrix or RLS expectation, the catalog-guard allowlists or the route allowlist. List any such change under **Permission changes** in the PR.
- CI runs every suite on every PR, and branch protection requires them to pass.
