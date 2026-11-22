// The permission matrix: actor × Channel × action → allow or deny, run through the real
// Hono app in-process against the real database (docs/spec/testing.md).
//
// Every route outside the route-coverage allowlist needs rows here: at least one allow,
// plus a deny for every standard actor who shouldn't pass. Deny with 404 when the actor
// can't see the Channel, 403 when they can see it but can't act.
//
// Never change an existing expectation unless the issue says so; list any such change
// under **Permission changes** in the PR.
import { randomUUID } from 'node:crypto';
import { type Actor, type ActorKind, CHANNEL_ROLE, STANDARD_ACTORS } from './actors';

export type ChannelKind = 'public' | 'private' | 'archived';

/** A route as Hono registers it, e.g. `POST /api/channels`. */
export type RouteKey = `${'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'} ${string}`;

export type RowContext = {
  actor: Actor;
  /** The row's Channel, created by the Channel fixtures. Undefined when `channel` is null. */
  channel: { id: string } | undefined;
  /** The row's target Staff member, when `target` asks for one. */
  target: { id: string } | undefined;
};

export type MatrixRow = {
  route: RouteKey;
  /** What the actor tries to do, in GLOSSARY.md terms. */
  action: string;
  actor: ActorKind;
  /** The Channel the action targets, or null for routes with no Channel. */
  channel: ChannelKind | null;
  /**
   * A Staff member the action targets, created before the request: an Invited person with
   * a live invite, another active Staff member, or a Deactivated one; someone in the row's
   * Channel as a plain member or as a second Channel admin; or the actor themself.
   */
  target?: 'invited' | 'active' | 'deactivated' | 'member' | 'channelAdmin' | 'self';
  /** Builds the request. The harness adds the actor's cookie and the app's origin. */
  request(ctx: RowContext): { path: string; method?: string; body?: unknown };
  expect: { allow: true; status: number } | { allow: false; status: 403 | 404 | 401 };
};

/** Every active standard actor: everyone but the Deactivated one. */
const ACTIVE_ACTORS = STANDARD_ACTORS.filter((kind) => kind !== 'deactivated');

const readChannel = (ctx: RowContext) => ({ path: `/api/channels/${ctx.channel?.id}` });

type RowBase = Omit<MatrixRow, 'actor' | 'expect'>;

/**
 * One row per standard actor. `expectFor` gives each active actor's expectation; the
 * Deactivated actor is denied everywhere: their session is gone, so it's a 401.
 */
const rowsFor = (base: RowBase, expectFor: (actor: ActorKind) => MatrixRow['expect']) => [
  ...ACTIVE_ACTORS.map((actor): MatrixRow => ({ ...base, actor, expect: expectFor(actor) })),
  { ...base, actor: 'deactivated', expect: { allow: false, status: 401 } } satisfies MatrixRow,
];

const allowed = (status: number) => (): MatrixRow['expect'] => ({ allow: true, status });

const ADMINS: ReadonlySet<ActorKind> = new Set(['adminNonMember', 'adminMember']);

/** Admins only: everyone else is refused with 403. */
const adminsOnly =
  (status: number) =>
  (actor: ActorKind): MatrixRow['expect'] =>
    ADMINS.has(actor) ? { allow: true, status } : { allow: false, status: 403 };

/** Nobody: every active actor is refused with 403. */
const refused = (): MatrixRow['expect'] => ({ allow: false, status: 403 });

const CHANNEL_KIND_NAME: Record<ChannelKind, string> = {
  public: 'Public',
  private: 'Private',
  archived: 'Archived Public',
};

/**
 * Members change only outside an Archived channel. A Private channel the actor isn't in
 * answers 404; any other refusal is 403. `allowed` says who may act in a Public or
 * Private channel.
 */
const membershipChange =
  (channel: ChannelKind, status: number, allowed: (actor: ActorKind) => boolean) =>
  (actor: ActorKind): MatrixRow['expect'] => {
    if (channel === 'private' && !CHANNEL_ROLE[actor]) return { allow: false, status: 404 };
    if (channel !== 'archived' && allowed(actor)) return { allow: true, status };
    return { allow: false, status: 403 };
  };

/** Add members: any member of a Public channel; Channel admins of a Private one. */
const mayAdd = (channel: ChannelKind) => (actor: ActorKind) =>
  channel === 'private' ? CHANNEL_ROLE[actor] === 'channelAdmin' : CHANNEL_ROLE[actor] !== null;

/** Appoint or remove a Channel admin: Channel admins; company Admins on a Public channel. */
const maySetChannelAdmin = (channel: ChannelKind) => (actor: ActorKind) =>
  CHANNEL_ROLE[actor] === 'channelAdmin' || (channel === 'public' && ADMINS.has(actor));

const isChannelAdmin = (actor: ActorKind) => CHANNEL_ROLE[actor] === 'channelAdmin';
const CHANNEL_KINDS = ['public', 'private', 'archived'] as const;
const memberPath = (ctx: RowContext) =>
  `/api/channels/${ctx.channel?.id}/members/${ctx.target?.id}`;

/** The rows. The first arrived with "Exemplar: create a Channel and open it" (#31). */
export const MATRIX: MatrixRow[] = [
  // Create a Channel: anyone, Public or Private.
  ...(['public', 'private'] as const).flatMap((visibility) =>
    rowsFor(
      {
        route: 'POST /api/channels',
        action: `create a ${visibility === 'public' ? 'Public' : 'Private'} channel`,
        channel: null,
        request: () => ({
          path: '/api/channels',
          method: 'POST',
          body: { name: 'Ops', description: 'Daily operations', visibility },
        }),
      },
      allowed(201),
    ),
  ),

  // List my Channels (the sidebar): anyone.
  ...rowsFor(
    {
      route: 'GET /api/channels',
      action: 'list the Channels they are a member of',
      channel: null,
      request: () => ({ path: '/api/channels' }),
    },
    allowed(200),
  ),

  // Read a Public channel: everyone, members or not. Archived channels stay readable.
  ...(['public', 'archived'] as const).flatMap((channel) =>
    rowsFor(
      {
        route: 'GET /api/channels/:channelId',
        action: `read a ${channel === 'public' ? 'Public' : 'Archived Public'} channel`,
        channel,
        request: readChannel,
      },
      allowed(200),
    ),
  ),

  // Read a Private channel: members only. Everyone else gets 404, company Admins included.
  ...rowsFor(
    {
      route: 'GET /api/channels/:channelId',
      action: 'read a Private channel',
      channel: 'private',
      request: readChannel,
    },
    (actor) => (CHANNEL_ROLE[actor] ? { allow: true, status: 200 } : { allow: false, status: 404 }),
  ),

  // Browse channels, join and leave. From "Browse, join and leave Public channels" (#36).
  ...rowsFor(
    {
      route: 'GET /api/channels/browse',
      action: 'browse the Public channels',
      channel: null,
      request: () => ({ path: '/api/channels/browse' }),
    },
    allowed(200),
  ),

  // Join a Public channel: anyone. A member joining again changes nothing.
  ...rowsFor(
    {
      route: 'POST /api/channels/:channelId/join',
      action: 'join a Public channel',
      channel: 'public',
      request: (ctx) => ({ path: `/api/channels/${ctx.channel?.id}/join`, method: 'POST' }),
    },
    allowed(200),
  ),

  // Join a Private channel: nobody. Its members are refused; everyone else gets 404,
  // company Admins included.
  ...rowsFor(
    {
      route: 'POST /api/channels/:channelId/join',
      action: 'join a Private channel',
      channel: 'private',
      request: (ctx) => ({ path: `/api/channels/${ctx.channel?.id}/join`, method: 'POST' }),
    },
    (actor) => ({ allow: false, status: CHANNEL_ROLE[actor] ? 403 : 404 }),
  ),

  // Join an Archived channel: nobody.
  ...rowsFor(
    {
      route: 'POST /api/channels/:channelId/join',
      action: 'join an Archived Public channel',
      channel: 'archived',
      request: (ctx) => ({ path: `/api/channels/${ctx.channel?.id}/join`, method: 'POST' }),
    },
    refused,
  ),

  // Leave a Channel: any member, except its last active Channel admin (the channelAdmin
  // actor is the fixture's only one). Archived channels can still be left. A Private
  // channel the actor isn't in answers 404; a Public one they aren't in, 403.
  ...(['public', 'private', 'archived'] as const).flatMap((channel) =>
    rowsFor(
      {
        route: 'POST /api/channels/:channelId/leave',
        action: `leave a ${{ public: 'Public', private: 'Private', archived: 'Archived Public' }[channel]} channel`,
        channel,
        request: (ctx) => ({ path: `/api/channels/${ctx.channel?.id}/leave`, method: 'POST' }),
      },
      (actor): MatrixRow['expect'] => {
        const role = CHANNEL_ROLE[actor];
        if (role === 'member') return { allow: true, status: 204 };
        if (role === 'channelAdmin') return { allow: false, status: 403 };
        return { allow: false, status: channel === 'private' ? 404 : 403 };
      },
    ),
  ),

  // Members and Channel admins. From "Channel members and Channel admins" (#37).

  // The Members tab: anyone who can read the Channel.
  ...CHANNEL_KINDS.flatMap((channel) =>
    rowsFor(
      {
        route: 'GET /api/channels/:channelId/members',
        action: `list the members of a ${CHANNEL_KIND_NAME[channel]} channel`,
        channel,
        request: (ctx) => ({ path: `/api/channels/${ctx.channel?.id}/members` }),
      },
      (actor) =>
        channel === 'private' && !CHANNEL_ROLE[actor]
          ? { allow: false, status: 404 }
          : { allow: true, status: 200 },
    ),
  ),

  // The add-members picker: whoever may add members.
  ...CHANNEL_KINDS.flatMap((channel) =>
    rowsFor(
      {
        route: 'GET /api/channels/:channelId/member-candidates',
        action: `list who can be added to a ${CHANNEL_KIND_NAME[channel]} channel`,
        channel,
        request: (ctx) => ({ path: `/api/channels/${ctx.channel?.id}/member-candidates` }),
      },
      membershipChange(channel, 200, mayAdd(channel)),
    ),
  ),

  // Add an active Staff member: any member of a Public channel, Channel admins of a
  // Private one. Company Admins get no exception.
  ...CHANNEL_KINDS.flatMap((channel) =>
    rowsFor(
      {
        route: 'POST /api/channels/:channelId/members',
        action: `add an active Staff member to a ${CHANNEL_KIND_NAME[channel]} channel`,
        channel,
        target: 'active',
        request: (ctx) => ({
          path: `/api/channels/${ctx.channel?.id}/members`,
          method: 'POST',
          body: { staffId: ctx.target?.id },
        }),
      },
      membershipChange(channel, 204, mayAdd(channel)),
    ),
  ),

  // Add an Invited or Deactivated person: nobody.
  ...(['invited', 'deactivated'] as const).flatMap((target) =>
    rowsFor(
      {
        route: 'POST /api/channels/:channelId/members',
        action: `add ${target === 'invited' ? 'an Invited' : 'a Deactivated'} person to a Public channel`,
        channel: 'public',
        target,
        request: (ctx) => ({
          path: `/api/channels/${ctx.channel?.id}/members`,
          method: 'POST',
          body: { staffId: ctx.target?.id },
        }),
      },
      refused,
    ),
  ),

  // Remove a member: Channel admins only, company Admins included.
  ...CHANNEL_KINDS.flatMap((channel) =>
    rowsFor(
      {
        route: 'DELETE /api/channels/:channelId/members/:staffId',
        action: `remove a member from a ${CHANNEL_KIND_NAME[channel]} channel`,
        channel,
        target: 'member',
        request: (ctx) => ({ path: memberPath(ctx), method: 'DELETE' }),
      },
      membershipChange(channel, 204, isChannelAdmin),
    ),
  ),

  // Appoint a member as Channel admin, and remove a second Channel admin's role: Channel
  // admins, and company Admins on a Public channel.
  ...CHANNEL_KINDS.flatMap((channel) =>
    (
      [
        ['appoint a member as Channel admin of', 'member', true],
        ['remove the Channel admin role from a second Channel admin of', 'channelAdmin', false],
      ] as const
    ).flatMap(([action, target, isChannelAdmin]) =>
      rowsFor(
        {
          route: 'PATCH /api/channels/:channelId/members/:staffId',
          action: `${action} a ${CHANNEL_KIND_NAME[channel]} channel`,
          channel,
          target,
          request: (ctx) => ({ path: memberPath(ctx), method: 'PATCH', body: { isChannelAdmin } }),
        },
        membershipChange(channel, 204, maySetChannelAdmin(channel)),
      ),
    ),
  ),

  // Make yourself Channel admin: a company Admin of a Public channel, member or not. A
  // Channel admin already is one, so it changes nothing.
  ...CHANNEL_KINDS.flatMap((channel) =>
    rowsFor(
      {
        route: 'PATCH /api/channels/:channelId/members/:staffId',
        action: `make themself Channel admin of a ${CHANNEL_KIND_NAME[channel]} channel`,
        channel,
        target: 'self',
        request: (ctx) => ({
          path: memberPath(ctx),
          method: 'PATCH',
          body: { isChannelAdmin: true },
        }),
      },
      membershipChange(channel, 204, maySetChannelAdmin(channel)),
    ),
  ),

  // Read your own role: anyone. From "Invites, bootstrap-admin and email" (#32).
  ...rowsFor(
    {
      route: 'GET /api/staff/me',
      action: 'read their own role',
      channel: null,
      request: () => ({ path: '/api/staff/me' }),
    },
    allowed(200),
  ),

  // List Staff members, Invited people included: Admins only.
  ...rowsFor(
    {
      route: 'GET /api/staff',
      action: 'list Staff members, with Invited people',
      channel: null,
      target: 'invited',
      request: () => ({ path: '/api/staff' }),
    },
    adminsOnly(200),
  ),

  // Invite someone: Admins only.
  ...rowsFor(
    {
      route: 'POST /api/staff/invites',
      action: 'invite a Staff member',
      channel: null,
      request: () => ({
        path: '/api/staff/invites',
        method: 'POST',
        body: {
          name: 'Rosa Ferrer',
          email: `invitee-${randomUUID()}@example.test`,
          role: 'member',
        },
      }),
    },
    adminsOnly(201),
  ),

  // Resend an invite: Admins only.
  ...rowsFor(
    {
      route: 'POST /api/staff/:staffId/invite/resend',
      action: 'resend an invite',
      channel: null,
      target: 'invited',
      request: (ctx) => ({ path: `/api/staff/${ctx.target?.id}/invite/resend`, method: 'POST' }),
    },
    adminsOnly(200),
  ),

  // Cancel an invite: Admins only.
  ...rowsFor(
    {
      route: 'DELETE /api/staff/:staffId/invite',
      action: 'cancel an invite',
      channel: null,
      target: 'invited',
      request: (ctx) => ({ path: `/api/staff/${ctx.target?.id}/invite`, method: 'DELETE' }),
    },
    adminsOnly(204),
  ),

  // Change your own display name and email: anyone, for themself. From "Profiles: display
  // name and email" (#34).
  ...rowsFor(
    {
      route: 'PATCH /api/staff/:staffId/name',
      action: 'change their own display name',
      channel: null,
      request: (ctx) => ({
        path: `/api/staff/${ctx.actor.staff.id}/name`,
        method: 'PATCH',
        body: { name: 'Rosa Ferrer' },
      }),
    },
    allowed(200),
  ),
  ...rowsFor(
    {
      route: 'POST /api/staff/:staffId/email',
      action: 'change their own email (a link goes to the new address)',
      channel: null,
      request: (ctx) => ({
        path: `/api/staff/${ctx.actor.staff.id}/email`,
        method: 'POST',
        body: { email: `new-${randomUUID()}@example.test` },
      }),
    },
    allowed(202),
  ),

  // Change someone else's display name or email: nobody, Admins included. An Admin who
  // could change someone's email could reset their password and sign in as them.
  ...rowsFor(
    {
      route: 'PATCH /api/staff/:staffId/name',
      action: 'change someone else’s display name',
      channel: null,
      target: 'active',
      request: (ctx) => ({
        path: `/api/staff/${ctx.target?.id}/name`,
        method: 'PATCH',
        body: { name: 'Rosa Ferrer' },
      }),
    },
    refused,
  ),
  ...rowsFor(
    {
      route: 'POST /api/staff/:staffId/email',
      action: 'change someone else’s email',
      channel: null,
      target: 'active',
      request: (ctx) => ({
        path: `/api/staff/${ctx.target?.id}/email`,
        method: 'POST',
        body: { email: `new-${randomUUID()}@example.test` },
      }),
    },
    refused,
  ),

  // Change someone's role, Deactivate and reactivate them: Admins only. From "Staff
  // management and Deactivation" (#35).
  ...rowsFor(
    {
      route: 'PATCH /api/staff/:staffId/role',
      action: 'change someone else’s role',
      channel: null,
      target: 'active',
      request: (ctx) => ({
        path: `/api/staff/${ctx.target?.id}/role`,
        method: 'PATCH',
        body: { role: 'admin' },
      }),
    },
    adminsOnly(200),
  ),
  ...rowsFor(
    {
      route: 'POST /api/staff/:staffId/deactivate',
      action: 'Deactivate someone else',
      channel: null,
      target: 'active',
      request: (ctx) => ({ path: `/api/staff/${ctx.target?.id}/deactivate`, method: 'POST' }),
    },
    adminsOnly(200),
  ),
  ...rowsFor(
    {
      route: 'POST /api/staff/:staffId/reactivate',
      action: 'reactivate a Deactivated Staff member',
      channel: null,
      target: 'deactivated',
      request: (ctx) => ({ path: `/api/staff/${ctx.target?.id}/reactivate`, method: 'POST' }),
    },
    adminsOnly(200),
  ),

  // Their own row. An Admin may demote themself while another active Admin is left (the
  // test database always has several); nobody may promote or Deactivate themself.
  // Row-level security agrees.
  ...rowsFor(
    {
      route: 'PATCH /api/staff/:staffId/role',
      action: 'change their own role',
      channel: null,
      request: (ctx) => ({
        path: `/api/staff/${ctx.actor.staff.id}/role`,
        method: 'PATCH',
        body: { role: ctx.actor.staff.role === 'admin' ? 'member' : 'admin' },
      }),
    },
    adminsOnly(200),
  ),
  ...rowsFor(
    {
      route: 'POST /api/staff/:staffId/deactivate',
      action: 'Deactivate themself',
      channel: null,
      request: (ctx) => ({ path: `/api/staff/${ctx.actor.staff.id}/deactivate`, method: 'POST' }),
    },
    refused,
  ),
];

/** Every route the matrix covers, for the route-coverage guard. */
export function coveredRoutes(rows: readonly MatrixRow[] = MATRIX): Set<RouteKey> {
  return new Set(rows.map((row) => row.route));
}
