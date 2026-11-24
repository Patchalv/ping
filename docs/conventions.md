# Code conventions

How code in Ping is written. This file is the single source: the path-scoped files in `.claude/rules/` only point here. Decided in [Which code conventions and lint rules does agent-written code follow?](https://github.com/Patchalv/ping/issues/19#issuecomment-6866693803) and first applied in [Exemplar: create a Channel and open it](https://github.com/Patchalv/ping/issues/31).

Where a tool can check a rule, the tool checks it. Each rule below names its tool. A rule marked **review only** has no tool behind it, so reviewers check it by hand.

## Start here: copy the exemplar

A new server feature copies `apps/server/src/features/channel/`:

- `routes.ts`: the routes, each in the same order (`signedIn`, `validate()`, `withActorTx` with a `require…` helper inside it, then `publish()`).
- `queries.ts`: the feature's queries, each taking the request's `ActorTx` (`{ tx, actor }`).
- `routes.int.test.ts`: what the routes answer, beyond the permission matrix.

Then, outside the feature folder:

- the decisions in `apps/server/src/permissions/channel.ts`, with unit tests beside them;
- the RLS cases in `apps/server/src/test/rls/channel.int.test.ts`;
- the matrix rows in `apps/server/src/test/permission-matrix/matrix.ts`;
- the schemas in `packages/shared/src/channel.ts`.

A new screen copies the structure of `apps/web/src/features/channel/`: `api.ts` (a query-key factory and hooks), with the components beside it, and a route in `apps/web/src/router.tsx`. Its look comes from the design system in `DESIGN.md` (see [The web app](#the-web-app)).

## Standards sources

Read these when writing or reviewing code. Code review checks changes against them.

- `docs/conventions.md` (this file)
- `docs/testing.md`: the test suites and what every slice ships
- `docs/spec/permissions.md`: who can do what, and the row-level security rules
- `docs/spec/data-model.md`: tables, columns and naming
- `docs/spec/screens.md`: layouts and flows
- `GLOSSARY.md`: the domain terms to use and the ones to avoid
- `docs/adr/`: decisions already made
- `biome.json`, `eslint.config.js`, `tsconfig.base.json`, `knip.json`, `.dependency-cruiser.cjs` and `check-terms.config.json`: the checked rules

## Tooling

| Tool | Checks | Runs in |
| --- | --- | --- |
| Biome | Formatting and lint, including no `any` and no `@ts-ignore` | After every edit, Stop gate, CI |
| ESLint | The type-aware rules (`no-floating-promises`, `no-misused-promises`, `switch-exhaustiveness-check`) and the route and effect rules below (`no-restricted-syntax`) | Stop gate, CI |
| TypeScript | `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`, `isolatedModules`, all set in `tsconfig.base.json`. `exactOptionalPropertyTypes` stays off because Drizzle and zod fight it. | Stop gate, CI |
| `scripts/check-ts-directives.ts` | Every `@ts-expect-error` and `eslint-disable` gives its reason after `--` | `pnpm lint`, CI |
| Knip | Unused files, exports and dependencies. Mark an export kept for later callers `@public`, with the reason | Stop gate, CI |
| dependency-cruiser | The import boundaries below | Stop gate, CI |
| `pnpm check:terms` | Banned terms in identifiers, file names and migration SQL | Stop gate, CI |

## Layout

```text
apps/server/src/
  auth/            Better Auth, signedIn and withActorTx, auth/queries.ts
  db/              schema, migrations, withStaffTx() (the only owner of the ping_app pool)
  permissions/     the single permissions module (ADR 0002)
  system-actions/  the only owner of the ping_system pool and the only caller of system functions (ADR 0004)
  features/<channel|thread|thread-response|mention|ping|saved|mute|search|attachment|staff|section>/
                   routes.ts, queries.ts, colocated tests
  lib/             errors, validation, sse/ (live updates: the hub, publish() and GET /api/live), and later storage and email
  test/            permission-matrix/, rls/, the catalog guard, route coverage
apps/web/src/
  router.tsx       the routes (TanStack Router)
  features/<…>/    api.ts (query keys and hooks) and the feature's components
  components/      the shell and shared pieces
  lib/             api.ts (the hc client), api-client.ts, query-client.ts, auth-client.ts
packages/shared/   zod schemas and shared types; never imports server code
```

| Rule | Checked by |
| --- | --- |
| Group code by feature, with folders named for the Glossary term | review only |
| A feature never imports another feature (server or web) | dependency-cruiser |
| `drizzle-orm` is imported only in `queries.ts` files, `db/` and `system-actions/` (and tests) | dependency-cruiser |
| No raw database connection outside `db/` | dependency-cruiser |
| Only `system-actions/` uses the `ping_system` pool | dependency-cruiser |
| Only `system-actions/` calls a system function | review only |
| `apps/web` imports server code with `import type` only | dependency-cruiser |
| `packages/shared` never imports server code | dependency-cruiser |
| Import from the file that defines a thing, not from a barrel | review only |

## Server routes

Every route in `features/<name>/routes.ts` follows the same steps, in this order.

| Rule | Checked by |
| --- | --- |
| `signedIn(auth)` is the route's first middleware, so a request with no session answers 401 before validation | `tsc`: `withActorTx` accepts only a context that has been through `signedIn` |
| Register middleware on each route, never with `app.use` | the route-coverage guard (it fails on any unlisted `ALL` route) |
| Validate params, query and body with `validate(target, schema)` from `lib/validate.ts`, using a schema from `packages/shared` | review only |
| Read input only through `c.req.valid(...)`; never `c.req.json()`, `c.req.param()` or `c.req.query()` | ESLint (`no-restricted-syntax`) |
| Do all the route's database work in one `withActorTx(c, (ctx) => …)`. It sets `app.staff_id`, reads the actor's role in the same transaction (401 when Deactivated), and passes queries one `{ tx, actor }`, so the two never disagree The live-update stream (`GET /api/live`) is the one exception: it opens with one `withActorTx`, then checks each event in a short transaction of its own, so none stays open on the stream. | review only; ESLint (`no-floating-promises`) for the awaits |
| Call a `require…` helper from `permissions/` inside `withActorTx`, before returning or changing anything, even when every actor is allowed. A route that needs the row to decide (reading a Channel needs its visibility) loads it first. Keep permission logic out of routes | review only; the permission matrix catches wrong answers |
| Throw errors, never return them: `NotFoundError`, `ForbiddenError`, `ConflictError`, `ValidationError`, `UnauthenticatedError`. Routes never set an error status | ESLint (`no-restricted-syntax` on `c.json` with a 4xx or 5xx); `app.test.ts` covers the mapping |
| Every error answers in one envelope, `{ error: { code, message, issues? } }`. A `ValidationError` lists every failing field as `issues: [{ path, message }]`. Hono's own errors (a malformed body, the Origin check) and unknown `/api` paths use the same envelope. Better Auth's routes keep their own | `app.test.ts` |
| An unknown error is a bare 500 and goes to Sentry. Typed errors are never reported | `app.test.ts` |
| 404 when the actor can't see the Channel (a Private channel they aren't in, Admins included); 403 when they can see it but can't act | the permission matrix |
| Every change calls `publish()` from `lib/sse/publish.ts` after its transaction commits, with a kind and IDs, never content | the publish-coverage check (`test/publish-coverage.int.test.ts`) for the call; review for after-commit and no content |
| Chain routes, and mount each feature with `.route()` in the chain in `createApp`, so Hono RPC infers `AppType` | `tsc` (the web app stops compiling when inference breaks) |
| Every route has permission-matrix rows: at least one allow, plus a deny for every standard actor who shouldn't pass | the route-coverage guard |
| Every `/api` response sends `Cache-Control: no-store`, and `csrf()` refuses form-style requests from untrusted origins. Both are set once, in `createApp` | `app.test.ts` |

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
| Grant `ping_app` only the commands the app uses (`channel` is SELECT only) | review only; the RLS suite |
| Policies check membership through the set-returning helpers (`current_staff_channel_ids()`, `current_staff_admin_channel_ids()`) as `= ANY (ARRAY(SELECT …))`, so they run once per statement, never through a per-row function | the RLS suite's query-plan test (for `channel`); review for new tables |
| Membership writes follow ADR 0005; other Channel-scoped tables use the visibility rule | the RLS suite |
| Every `SECURITY DEFINER` function is on the allowlist and pins its `search_path` | the catalog guard |
| A system function reads the actor from `app.staff_id`, never from an argument, and does one fixed job | the RLS suite |
| Every new table has RLS cases for SELECT, INSERT, UPDATE, DELETE and failing closed | review only |
| Migrations already on `origin/master` are never edited | the migration-guard hook |
| Expand, then contract: a migration works with the previous release's code | review only |

## Validation and the API contract

| Rule | Checked by |
| --- | --- |
| zod schemas live in `packages/shared`, and the SPA reuses them for its forms and route params | review only |
| Every rule a Staff member can trip has a plain-English message saying what to do ("Keep the name to 80 characters or fewer."), never zod's default text | the schema's unit tests |
| The ProseMirror allowlist validator runs inside the body schema (from the Threads slice) | review only |
| The SPA calls the server only through the `hc` client in `apps/web/src/lib/api.ts`, inside a feature's `api.ts`. Two exceptions: Better Auth's own client, and the live-update stream (`components/use-live-updates.ts`), which the browser's `EventSource` opens so it can resume with `Last-Event-ID` | review only |
| No OpenAPI in the MVP | review only |

## The web app

**The look follows `DESIGN.md`**: the colour roles, type scale, spacing, shapes and components, with their do's and don'ts. Read it before building a screen. The stack is in [ADR 0007](adr/0007-shadcn-on-base-ui.md): shadcn/ui on Base UI, Tailwind CSS v4, lucide-react and Figtree.

| Rule | Checked by |
| --- | --- |
| **Components:** build from `apps/web/src/components/ui/`. Add a missing one with `pnpm dlx shadcn@4.23.0 add <name>` from `apps/web`, then lint it and adapt it to `DESIGN.md` | review only |
| **Styling:** Tailwind utilities with the semantic tokens (`bg-primary`, `text-muted-foreground`, `bg-ping`, `bg-sidebar`), never raw colours. `apps/web/src/index.css` holds the tokens and base styles only: no per-feature CSS files and no `@apply` in components | review only; Impeccable's detector runs after every edit |
| **Composition:** compound components and explicit variants, `children` over render props, and no boolean props that switch a component's mode (`.claude/skills/vercel-composition-patterns`) | review only |
| **Imports:** shared code (`#/components/ui/…`, `#/lib/…`) can be imported with `#/` from `package.json#imports`, which the shadcn components use; relative imports stay fine inside a feature. Import `cn` from `#/lib/utils`, never from the `cn` package, so the custom type step merges correctly | review only; `lib/utils.test.ts` |
| Every text pair meets WCAG AA (4.5:1) in light and dark, and every action works from the keyboard | review only; check in the browser |
| UI state shared by compound components may use context (`SidebarProvider`); server data never does | review only |

The structure ([ADR 0006](adr/0006-web-data-and-routing.md)):

| Rule | Checked by |
| --- | --- |
| **Data:** server data lives in TanStack Query, through each feature's `api.ts`: a query-key factory and hooks only. Components never call `hc` or read a response themselves. Mutations invalidate by key | review only |
| **One QueryClient per signed-in Staff member**, keyed by their ID, so nothing cached reaches the next person to sign in | Playwright (`e2e/channel.spec.ts`) |
| A 401 anywhere returns the Staff member to sign-in; a failed network call shows "Can't reach Ping. Try again." | `lib/query-client.test.ts`, `lib/api-client.test.ts`, Playwright |
| **Navigation:** TanStack Router, code-based routes in `router.tsx`. Navigation state lives in the URL. Validate params and search params with the schemas in `packages/shared`; a failure is not found | `router.test.ts` |
| **State:** everything else is local `useState`. No global store, and no data in React context, without an ADR | review only |
| **Effects:** only to sync with something outside React, with the reason in the disable comment. Never for fetching, derived state or reacting to events | ESLint (`no-restricted-syntax`) and `check-ts-directives` |
| **React rules:** derive state during render; put interaction logic in event handlers; never define a component inside a component; use functional `setState` when the next value depends on the last; use a ternary, not `&&`, for conditional rendering; run independent awaits in parallel | review only |
| No permission logic beyond hiding controls the Staff member can't use | review only |
| Screens follow `docs/spec/screens.md` (prototype B2) | review only; Impeccable's detector runs after every edit |
| A 404 from the API shows "not found", the same for a missing Channel and a hidden one | Playwright |
| No React component tests. Unit-test pure helpers and routes; Playwright covers the journeys | review only |

Forms ([ADR 0008](adr/0008-forms-on-tanstack-form.md)). Copy `features/channel/CreateChannelDialog.tsx` (with a server call) or `SignIn.tsx` (with one form-level error):

| Rule | Checked by |
| --- | --- |
| **Every form** uses `useAppForm` from `#/components/form` with a `formId`, and builds from `form.Form`, the bound fields (`field.TextField`, `field.TextareaField`, `field.RadioGroupField`) and `form.SubmitButton`. Never wire `aria-invalid`, `aria-describedby` or `FieldError` by hand: a new kind of control gets a bound field in `components/form.tsx` built on `useFieldWiring()` | review only |
| **Validation:** the schema from `packages/shared`, passed straight in: `validationLogic: revalidateLogic()` and `validators: { onDynamic: schema }`. It checks on submit, then on every change after a failed submit. `onSubmit` sends `schema.parse(value)`, the schema's output. Never copy a rule or a transform into the web app | review only |
| **Server failures:** `onSubmit` awaits the mutation (`mutateAsync`) and catches the `ApiError`. `showServerIssues(formApi, error.issues)` puts field issues on their fields; when none land, the message goes in local state and shows as `FormError`. Never put a form-level failure in the form's error map: it blocks the retry | Playwright (`e2e/channel.spec.ts`) |
| **Focus and keyboard:** on a failed submit, focus moves to the first field with an error. A custom control (the TipTap editor) puts the wiring's id, `data-field` and aria attributes on the element that takes focus | Playwright |
| **The submit button** is disabled only while submitting, never for being invalid | Playwright |
| **Drafts** are restored once, as `defaultValues` through a lazy `useState`, and saved from the form's `listeners.onChange`, debounced, never from an effect. Each key starts `ping:draft:<staffMemberId>:`, an empty form removes its draft, and signing out clears them | review only |

## Names

| Rule | Checked by |
| --- | --- |
| Glossary terms in code: Thread, not ticket; Thread Response, not reply; Ping, not notification | `pnpm check:terms` (the worst offenders); review for the rest |
| Tables are singular snake_case, TypeScript values camelCase, types PascalCase | review only |
