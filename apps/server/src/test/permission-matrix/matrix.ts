// The permission matrix: actor × Channel × action → allow or deny, run through the real
// Hono app in-process against the real database (docs/spec/testing.md).
//
// Every route outside the route-coverage allowlist needs rows here: at least one allow,
// plus a deny for every standard actor who shouldn't pass. Deny with 404 when the actor
// can't see the Channel, 403 when they can see it but can't act.
//
// Never change an existing expectation unless the issue says so; list any such change
// under **Permission changes** in the PR.
import { type Actor, type ActorKind, CHANNEL_ROLE, STANDARD_ACTORS } from './actors';

export type ChannelKind = 'public' | 'private' | 'archived';

/** A route as Hono registers it, e.g. `POST /api/channels`. */
export type RouteKey = `${'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'} ${string}`;

export type RowContext = {
  actor: Actor;
  /** The row's Channel, created by the Channel fixtures. Undefined when `channel` is null. */
  channel: { id: string } | undefined;
};

export type MatrixRow = {
  route: RouteKey;
  /** What the actor tries to do, in GLOSSARY.md terms. */
  action: string;
  actor: ActorKind;
  /** The Channel the action targets, or null for routes with no Channel. */
  channel: ChannelKind | null;
  /** Builds the request. The harness adds the actor's cookie and the app's origin. */
  request(ctx: RowContext): { path: string; method?: string; body?: unknown };
  expect: { allow: true; status: number } | { allow: false; status: 403 | 404 | 401 };
};

/** Every active standard actor: everyone but the Deactivated one. */
const ACTIVE_ACTORS = STANDARD_ACTORS.filter((kind) => kind !== 'deactivated');

const readChannel = (ctx: RowContext) => ({ path: `/api/channels/${ctx.channel?.id}` });

/** The Deactivated actor is denied everywhere: their session is gone, so it's a 401. */
const deactivatedRow = (row: Omit<MatrixRow, 'actor' | 'expect'>): MatrixRow => ({
  ...row,
  actor: 'deactivated',
  expect: { allow: false, status: 401 },
});

/** The rows. The first arrived with "Exemplar: create a Channel and open it" (#31). */
export const MATRIX: MatrixRow[] = [
  // Create a Channel: anyone, Public or Private.
  ...(['public', 'private'] as const).flatMap((visibility): MatrixRow[] => {
    const row = {
      route: 'POST /api/channels',
      action: `create a ${visibility === 'public' ? 'Public' : 'Private'} channel`,
      channel: null,
      request: () => ({
        path: '/api/channels',
        method: 'POST',
        body: { name: 'Ops', description: 'Daily operations', visibility },
      }),
    } as const;
    return [
      ...ACTIVE_ACTORS.map(
        (actor): MatrixRow => ({ ...row, actor, expect: { allow: true, status: 201 } }),
      ),
      deactivatedRow(row),
    ];
  }),

  // List my Channels (the sidebar): anyone.
  ...ACTIVE_ACTORS.map(
    (actor): MatrixRow => ({
      route: 'GET /api/channels',
      action: 'list the Channels they are a member of',
      actor,
      channel: null,
      request: () => ({ path: '/api/channels' }),
      expect: { allow: true, status: 200 },
    }),
  ),
  deactivatedRow({
    route: 'GET /api/channels',
    action: 'list the Channels they are a member of',
    channel: null,
    request: () => ({ path: '/api/channels' }),
  }),

  // Read a Public channel: everyone, members or not. Archived channels stay readable.
  ...(['public', 'archived'] as const).flatMap((channel): MatrixRow[] => {
    const row = {
      route: 'GET /api/channels/:channelId',
      action: `read a ${channel === 'public' ? 'Public' : 'Archived Public'} channel`,
      channel,
      request: readChannel,
    } as const;
    return [
      ...ACTIVE_ACTORS.map(
        (actor): MatrixRow => ({ ...row, actor, expect: { allow: true, status: 200 } }),
      ),
      deactivatedRow(row),
    ];
  }),

  // Read a Private channel: members only. Everyone else gets 404, company Admins included.
  ...(() => {
    const row = {
      route: 'GET /api/channels/:channelId',
      action: 'read a Private channel',
      channel: 'private',
      request: readChannel,
    } as const;
    return [
      ...ACTIVE_ACTORS.map(
        (actor): MatrixRow => ({
          ...row,
          actor,
          expect: CHANNEL_ROLE[actor]
            ? { allow: true, status: 200 }
            : { allow: false, status: 404 },
        }),
      ),
      deactivatedRow(row),
    ];
  })(),
];

/** Every route the matrix covers, for the route-coverage guard. */
export function coveredRoutes(rows: readonly MatrixRow[] = MATRIX): Set<RouteKey> {
  return new Set(rows.map((row) => row.route));
}
