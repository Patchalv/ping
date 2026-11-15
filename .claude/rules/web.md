---
paths:
  - "apps/web/**"
---

# Touching the web app

Follow `docs/conventions.md` › The web app, and copy the structure (not the look) of `apps/web/src/features/channel/`. Never miss these:

- Server data only through TanStack Query hooks in the feature's `api.ts`; components never call `hc`. Navigation through TanStack Router in `router.tsx`.
- No `useEffect` except to sync with something outside React, with the reason in the disable comment. No global store or data in context without an ADR.
- Import server code with `import type` only, and add no permission logic beyond hiding controls.
- Check the change in the browser before the PR: start `ping-dev` from `.claude/launch.json`, sign in as a seeded Staff member, and say what you checked under **Browser check**.
