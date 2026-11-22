// Live updates. Every change a route makes calls publish(), after its transaction has
// committed, so a rolled-back change never goes out. "Live updates over SSE" (#47) wires
// delivery; until then publish() does nothing.

/**
 * What changed: a kind and IDs, never content. A client that hears it refetches through
 * the API, where the permissions module and row-level security decide what it may see.
 */
type LiveEvent =
  | { kind: 'channel.created'; channelId: string }
  // A Channel admin was promoted, or the Channel archived, by a Deactivation.
  | { kind: 'channel.changed'; channelId: string }
  // Someone was invited, re-invited, had their invite cancelled, changed their name or
  // role, or was Deactivated or reactivated.
  | { kind: 'staff.changed'; staffId: string };

export function publish(_event: LiveEvent): void {
  // Delivery arrives with #47.
}
