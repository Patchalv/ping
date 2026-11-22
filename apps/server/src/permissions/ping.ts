// Pings (permissions.md › Pings and Saved). Everyone lists their own Pings: row-level
// security means they only ever see their own. Marking a Ping read takes only being able to
// read its Thread, so it follows `canReadThreads`: a Public channel's non-members may,
// and a Private channel they aren't in is hidden.
import type { Actor } from './actor';
import { allow, type Decision, requireAllowed } from './decision';

/** Anyone lists their own Pings, and the counts beside them. */
export function canListOwnPings(_actor: Actor): Decision {
  return allow();
}

export function requireCanListOwnPings(actor: Actor): void {
  requireAllowed(canListOwnPings(actor));
}
