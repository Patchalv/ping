# The web app keeps server data in TanStack Query and navigation in TanStack Router

**Status:** accepted

The first slice shipped a hand-rolled History-API router and a small `useResource` hook. Neither would last. Live updates (#47) need "refetch Channel X everywhere", which a hook that reloads through callbacks passed down as props can't do. Threads need nested routes, and search needs validated search params. Every later screen copies the exemplar, so the choice had to be made before three screens copied the wrong one.

## Decision

- **Server data lives in TanStack Query.**
  - Each feature's `api.ts` exports a query-key factory and hooks only (for example `useMyChannels`, `useChannel`, `useCreateChannel`). Components use the hooks and never call the `hc` client or read a response themselves.
  - Mutations invalidate by key. Live updates will invalidate by the same keys.
  - A 4xx is never retried. A failed network call or a 5xx is retried twice.
  - A 401 from any query or mutation refetches the Better Auth session, so the app falls back to sign-in.
  - **One QueryClient per signed-in Staff member**, created under a React key of their ID. Signing out, or another person signing in on the same browser, discards the whole cache, so a cached Private channel can never reach the next person. Playwright checks it.
- **Navigation lives in the URL, through TanStack Router, with code-based routes.** Params and search params are validated with the zod schemas in `packages/shared`. A path that fails them is not found. Per-browser preferences that a shared link shouldn't carry (theme, panel widths, a Channel's Thread list controls) stay out of the URL: they live in `localStorage` through `lib/storage.ts`, are validated with the same zod schemas on read, and fall back to the defaults when storage is missing or blocked.
- **Everything else is local `useState`.** A global store, or data held in React context, needs its own ADR.
- **Effects only sync with something outside React**, such as document events, and each one says why in its lint-disable comment. ESLint bans `useEffect` in `apps/web` otherwise.

## Considered options

- **Keep the hand-rolled router and `useResource`:** rejected, for the reasons above.
- **TanStack Router's file-based routes:** not chosen. They need a build plugin and generated files, which is too much for a handful of routes. Code-based routes can move to files later.
- **A global store (Redux, Zustand) for server data:** rejected. Query already caches, deduplicates and invalidates server data, and a second copy would drift.
- **SWR:** not chosen. Query's mutation and invalidation model fits the live-update plan better.
- **The visual design** (tokens, type, components, and whether to use a component library) is not decided here. #65 settles it.
