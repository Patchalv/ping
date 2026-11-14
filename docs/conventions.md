# Code conventions

How code in Ping is written. Decided in [Which code conventions and lint rules does agent-written code follow?](https://github.com/Patchalv/ping/issues/19#issuecomment-6866693803) and first applied in [Exemplar: create a Channel and open it](https://github.com/Patchalv/ping/issues/31).

Where a tool can check a rule, the tool checks it. Each rule below names its tool. A rule marked **review only** has no tool behind it, so reviewers check it by hand.

## Start here: copy the exemplar

A new server feature copies `apps/server/src/features/channel/`:

- `routes.ts`: the routes, in the order every route follows (session, validation, permission check, `withStaffTx`, `publish()`).
- `queries.ts`: the feature's queries, each taking the request's `tx`.
- `routes.int.test.ts`: what the routes answer, beyond the permission matrix.

Then, outside the feature folder:

- the decisions in `apps/server/src/permissions/channel.ts`, with unit tests beside them;
- the RLS cases in `apps/server/src/test/rls/channel.int.test.ts`;
- the matrix rows in `apps/server/src/test/permission-matrix/matrix.ts`;
- the schemas in `packages/shared/src/channel.ts`.

A new screen copies `apps/web/src/features/channel/`. `api.ts` holds the feature's calls through the typed client, and the components sit beside it.

## Standards sources

Read these when writing or reviewing code. Code review checks changes against them.

- `docs/conventions.md` (this file)
- `docs/testing.md`: the test suites and what every slice ships
- `docs/spec/permissions.md`: who can do what, and the row-level security rules
- `docs/spec/data-model.md`: tables, columns and naming
- `docs/spec/screens.md`: layouts and flows
- `GLOSSARY.md`: the domain terms to use and the ones to avoid
- `docs/adr/`: decisions already made
- `.claude/rules/`: path-scoped rules for migrations, server routes and the web app
- `biome.json`, `eslint.config.js`, `tsconfig.base.json`, `knip.json`, `.dependency-cruiser.cjs` and `check-terms.config.json`: the checked rules

## Tooling

| Tool | Checks | Runs in |
| --- | --- | --- |
| Biome | Formatting and lint, including no `any` and no `@ts-ignore` | After every edit, Stop gate, CI |
| ESLint (type-aware) | `no-floating-promises`, `no-misused-promises`, `switch-exhaustiveness-check` | Stop gate, CI |
| TypeScript | `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, `isolatedModules`, all set in `tsconfig.base.json`. `exactOptionalPropertyTypes` stays off because Drizzle and zod fight it. | Stop gate, CI |
| `scripts/check-ts-directives.ts` | `@ts-expect-error` must give a reason | `pnpm lint`, CI |
| Knip | Unused files, exports and dependencies | Stop gate, CI |
| dependency-cruiser | The import boundaries below | Stop gate, CI |
| `pnpm check:terms` | Banned terms in identifiers, file names and migration SQL | Stop gate, CI |

## Layout

```text
apps/server/src/
  db/              schema, migrations, withStaffTx() (the only owner of the ping_app pool)
  permissions/     the single permissions module (ADR 0002)
  system-actions/  the only owner of the ping_system pool and the only caller of system functions (ADR 0004)
  features/<channel|thread|thread-response|ping|saved|search|attachment|staff|section>/
                   routes.ts, queries.ts, colocated tests
  lib/             errors, validation, sse, and later storage and email
  test/            permission-matrix/, rls/, the catalog guard, route coverage
apps/web/src/      features/<…>/, components/, lib/ (api.ts is the hc client)
packages/shared/   zod schemas and shared types; never imports server code
```

| Rule | Checked by |
| --- | --- |
| Group code by feature, with folders named for the Glossary term | review only |
| No raw database connection outside `db/` | dependency-cruiser |
| Only `system-actions/` uses the `ping_system` pool | dependency-cruiser |
| Only `system-actions/` calls a system function | review only |
| `apps/web` imports server code with `import type` only | dependency-cruiser |
| `packages/shared` never imports server code | dependency-cruiser |

## Server routes

Every route in `features/<name>/routes.ts` follows the same steps, in this order.

| Rule | Checked by |
| --- | --- |
| `signedIn(auth, database)` comes first on any route that needs a Staff member, so a request with no session answers 401, not 400 | review only; the permission matrix's Deactivated rows expect 401 |
| Register middleware on each route, never with `app.use` | the route-coverage guard (it fails on any unlisted `ALL` route) |
| Validate params, query and body with `validate(target, schema)` from `lib/validate.ts`, using a schema from `packages/shared` | review only |
| Read input only through `c.req.valid(...)` | review only |
| Call a `require…` helper from `permissions/` before any work, even when every actor is allowed. A route that needs the row to decide (reading a Channel needs its visibility) loads it inside `withStaffTx` first, then decides before returning or changing anything. Keep permission logic out of routes | review only; the permission matrix catches wrong answers |
| Run every query inside `withStaffTx`, and await it | ESLint (`no-floating-promises`) for the await; review for the wrapper |
| Throw errors, never return them: `NotFoundError`, `ForbiddenError`, `ConflictError`, `ValidationError` (and `UnauthenticatedError` for 401). One `onError` in `app.ts` maps them. Routes never set error statuses by hand | review only; `app.test.ts` covers the mapping |
| 404 when the actor can't see the Channel (a Private channel they aren't in, Admins included); 403 when they can see it but can't act | the permission matrix |
| An unknown error is a bare 500 and goes to Sentry. Typed errors are never reported | `app.test.ts` |
| Every change calls `publish()` from `lib/sse.ts` after its transaction commits, with a kind and IDs, never content | review only |
| Chain routes, and mount each feature with `.route()` in the chain in `createApp`, so Hono RPC infers `AppType` | `tsc` (the web app stops compiling when inference breaks) |
| Every route has permission-matrix rows: at least one allow, plus a deny for every standard actor who shouldn't pass | the route-coverage guard |

## The permissions module

| Rule | Checked by |
| --- | --- |
| Decision functions (`can…`) are pure and return `allow()` or `deny(reason)`, so they're unit-tested | review only |
| A deny's reason is `hidden` (answers 404) or `refused` with a message the UI shows (answers 403) | `tsc` |
| `require…` helpers turn a deny into a thrown error | `permissions/channel.test.ts` |

## The database

| Rule | Checked by |
| --- | --- |
| Every table has `ENABLE` and `FORCE ROW LEVEL SECURITY` and a policy, in the migration that adds it | the catalog guard |
| Every `SECURITY DEFINER` function is on the allowlist and pins its `search_path` | the catalog guard |
| A system function reads the actor from `app.staff_id`, never from an argument, and does one fixed job | the RLS suite |
| Every new table has RLS cases for SELECT, INSERT, UPDATE, DELETE and failing closed | review only |
| Migrations already on `origin/master` are never edited | the migration-guard hook |
| Expand, then contract: a migration works with the previous release's code | review only |

## Validation and the API contract

| Rule | Checked by |
| --- | --- |
| zod schemas live in `packages/shared`, and the SPA reuses them for its forms | review only |
| The ProseMirror allowlist validator runs inside the body schema (from the Threads slice) | review only |
| The SPA calls the server only through the `hc` client in `apps/web/src/lib/api.ts`. Better Auth's own client is the one exception | review only |
| No OpenAPI in the MVP | review only |

## The web app

| Rule | Checked by |
| --- | --- |
| No permission logic beyond hiding controls the Staff member can't use | review only |
| Screens follow `docs/spec/screens.md` (prototype B2) | review only; Impeccable's detector runs after every edit |
| A 404 from the API shows "not found", the same for a missing Channel and a hidden one | Playwright (`e2e/channel.spec.ts`) |
| No React component tests. Unit-test pure helpers; Playwright covers the journeys | review only |

## Names

| Rule | Checked by |
| --- | --- |
| Glossary terms in code: Thread, not ticket; Thread Response, not reply; Ping, not notification | `pnpm check:terms` (the worst offenders); review for the rest |
| Tables are singular snake_case, TypeScript values camelCase, types PascalCase | review only |
