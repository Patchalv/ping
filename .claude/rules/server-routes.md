---
paths:
  - "apps/server/src/features/**"
---

# Touching a server route

Follow `docs/conventions.md` › Server routes, and copy `apps/server/src/features/channel/`. Never miss these:

- `signedIn(auth)` first, then `validate(...)`, then all the work in one `withActorTx(c, (ctx) => …)` with a `require…` helper inside it, before returning or changing anything.
- Throw typed errors; never set an error status. A Private channel the actor can't see is a `NotFoundError` (404), Admins included.
- Call `publish()` after every change commits.
- Add permission-matrix rows for every new or changed route. Never change an existing expectation unless the issue says so; list it under **Permission changes**.
