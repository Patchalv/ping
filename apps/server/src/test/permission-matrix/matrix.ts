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
import type { ResolvePolicy } from '@ping/shared';
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
  /** The row's Thread, in the row's Channel, when `thread` asks for one. */
  thread: { id: string } | undefined;
  /** The row's Thread Response, in the row's Thread, when `response` asks for one. */
  response: { id: string } | undefined;
  /** The row's Sidebar Section, when `section` asks for one. */
  section: { id: string } | undefined;
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
  /**
   * A Thread in the row's Channel, started by the author actor (or, for any other actor, by
   * a member): open, or Resolved by its author.
   */
  thread?: true | 'resolved';
  /** The row's Channel's "Who can resolve threads?" setting; `any_member` when unset. */
  resolvePolicy?: ResolvePolicy;
  /**
   * A Thread Response in the row's Thread (which needs `thread`), sent by the author actor
   * (or, for any other actor, by a member).
   */
  response?: true;
  /** A Sidebar Section: the actor's own, or another Staff member's. */
  section?: 'own' | 'other';
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

/** Reading: anyone, except that a Private channel the actor isn't in is hidden (404). */
const readsChannel =
  (channel: ChannelKind) =>
  (actor: ActorKind): MatrixRow['expect'] =>
    channel === 'private' && !CHANNEL_ROLE[actor]
      ? { allow: false, status: 404 }
      : { allow: true, status: 200 };

/**
 * Editing or deleting content: its author, or a company Admin in a Channel they can read.
 * Channel admins get nothing extra. A Private channel the actor isn't in is hidden (404),
 * Admins included. In an Archived channel nothing is edited, and only Admins delete.
 */
const contentChange =
  (channel: ChannelKind, change: 'edit' | 'delete', status: number) =>
  (actor: ActorKind): MatrixRow['expect'] => {
    if (channel === 'private' && !CHANNEL_ROLE[actor]) return { allow: false, status: 404 };
    if (channel === 'archived' && (change === 'edit' || !ADMINS.has(actor))) {
      return { allow: false, status: 403 };
    }
    return actor === 'author' || ADMINS.has(actor)
      ? { allow: true, status }
      : { allow: false, status: 403 };
  };

/**
 * Resolving or reopening, by the Channel's "Who can resolve threads?" setting: any member,
 * or only the Thread's author and Channel admins. Company Admins get no exception; a
 * non-member must join first (403), and a Private channel they aren't in is hidden (404).
 * Nobody does it in an Archived channel.
 */
const resolveChange =
  (channel: ChannelKind, policy: NonNullable<MatrixRow['resolvePolicy']>) =>
  (actor: ActorKind): MatrixRow['expect'] => {
    const role = CHANNEL_ROLE[actor];
    if (channel === 'private' && !role) return { allow: false, status: 404 };
    if (channel === 'archived' || !role) return { allow: false, status: 403 };
    if (policy === 'any_member' || actor === 'author' || role === 'channelAdmin') {
      return { allow: true, status: 200 };
    }
    return { allow: false, status: 403 };
  };

/** Another Staff member's Section: row-level security hides it from everyone (404). */
const hiddenSection = (): MatrixRow['expect'] => ({ allow: false, status: 404 });

/**
 * Placing a Channel in a Section: its members, Archived channels included. A Private
 * channel the actor isn't in is hidden (404); a Public one they haven't joined, refused.
 */
const placesChannel =
  (channel: ChannelKind) =>
  (actor: ActorKind): MatrixRow['expect'] => {
    if (CHANNEL_ROLE[actor]) return { allow: true, status: 204 };
    return { allow: false, status: channel === 'private' ? 404 : 403 };
  };

const isChannelAdmin = (actor: ActorKind) => CHANNEL_ROLE[actor] === 'channelAdmin';
const CHANNEL_KINDS = ['public', 'private', 'archived'] as const;
const threadPath = (ctx: RowContext) =>
  `/api/channels/${ctx.channel?.id}/threads/${ctx.thread?.id}`;
/** A description that Mentions one Staff member. */
const mentionDoc = (staffId: string | undefined) => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Over to ' },
        { type: 'mention', attrs: { id: staffId, label: 'Someone', mentionSuggestionChar: '@' } },
      ],
    },
  ],
});

const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
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

  // Appoint someone outside the Channel: only a company Admin, on a Public channel. A
  // Channel admin is asked to add them first.
  ...CHANNEL_KINDS.flatMap((channel) =>
    rowsFor(
      {
        route: 'PATCH /api/channels/:channelId/members/:staffId',
        action: `appoint someone outside a ${CHANNEL_KIND_NAME[channel]} channel as its Channel admin`,
        channel,
        target: 'active',
        request: (ctx) => ({
          path: memberPath(ctx),
          method: 'PATCH',
          body: { isChannelAdmin: true },
        }),
      },
      membershipChange(channel, 204, (actor) => channel === 'public' && ADMINS.has(actor)),
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

  // Channel settings and visibility. From "Channel settings, visibility change and System
  // threads" (#42).

  // Edit the name, description and "Who can resolve threads?": Channel admins only, outside
  // an Archived channel. A company Admin who isn't Channel admin is refused on a Public
  // channel and can't see a Private one they aren't in.
  ...CHANNEL_KINDS.flatMap((channel) =>
    rowsFor(
      {
        route: 'PATCH /api/channels/:channelId',
        action: `edit the settings of a ${CHANNEL_KIND_NAME[channel]} channel`,
        channel,
        request: (ctx) => ({
          path: `/api/channels/${ctx.channel?.id}`,
          method: 'PATCH',
          body: {
            name: 'Front desk',
            description: 'Reception and visitors',
            resolvePolicy: 'author_and_channel_admins',
          },
        }),
      },
      membershipChange(channel, 200, (actor) => CHANNEL_ROLE[actor] === 'channelAdmin'),
    ),
  ),

  // Turn a Public channel Private: Channel admins only, outside an Archived channel.
  ...(['public', 'archived'] as const).flatMap((channel) =>
    rowsFor(
      {
        route: 'PATCH /api/channels/:channelId',
        action: `turn a ${CHANNEL_KIND_NAME[channel]} channel Private`,
        channel,
        request: (ctx) => ({
          path: `/api/channels/${ctx.channel?.id}`,
          method: 'PATCH',
          body: { visibility: 'private' },
        }),
      },
      membershipChange(channel, 200, (actor) => CHANNEL_ROLE[actor] === 'channelAdmin'),
    ),
  ),

  // Make a Private channel Public: refused for every actor, its Channel admins included.
  // Anyone not in it can't see it at all.
  ...rowsFor(
    {
      route: 'PATCH /api/channels/:channelId',
      action: 'make a Private channel Public',
      channel: 'private',
      request: (ctx) => ({
        path: `/api/channels/${ctx.channel?.id}`,
        method: 'PATCH',
        body: { visibility: 'public' },
      }),
    },
    membershipChange('private', 200, () => false),
  ),

  // Threads. From "Start and read Threads" (#38).

  // Start a Thread: Channel members only, company Admins included. A non-member of a
  // Public channel must join first (403); a Private channel they aren't in is hidden
  // (404). Nobody starts one in an Archived channel.
  ...CHANNEL_KINDS.flatMap((channel) =>
    rowsFor(
      {
        route: 'POST /api/channels/:channelId/threads',
        action: `start a Thread in a ${CHANNEL_KIND_NAME[channel]} channel`,
        channel,
        request: (ctx) => ({
          path: `/api/channels/${ctx.channel?.id}/threads`,
          method: 'POST',
          body: {
            title: 'Heater broken in room 2',
            body: {
              type: 'doc',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Since Monday.' }] }],
            },
          },
        }),
      },
      membershipChange(channel, 201, (actor) => CHANNEL_ROLE[actor] !== null),
    ),
  ),

  // Read a Channel's Thread list, and one Thread: anyone who can read the Channel.
  // Archived channels stay readable.
  ...CHANNEL_KINDS.flatMap((channel) => [
    ...rowsFor(
      {
        route: 'GET /api/channels/:channelId/threads',
        action: `list the Threads of a ${CHANNEL_KIND_NAME[channel]} channel`,
        channel,
        request: (ctx) => ({ path: `/api/channels/${ctx.channel?.id}/threads` }),
      },
      readsChannel(channel),
    ),
    ...rowsFor(
      {
        route: 'GET /api/channels/:channelId/threads/:threadId',
        action: `read a Thread in a ${CHANNEL_KIND_NAME[channel]} channel`,
        channel,
        thread: true,
        request: (ctx) => ({
          path: `/api/channels/${ctx.channel?.id}/threads/${ctx.thread?.id}`,
        }),
      },
      readsChannel(channel),
    ),
  ]),

  // Thread Responses, editing and deleting. From "Thread Responses, editing and deleting"
  // (#39).

  // Send a Thread Response: Channel members only, company Admins included; not in an
  // Archived channel.
  ...CHANNEL_KINDS.flatMap((channel) =>
    rowsFor(
      {
        route: 'POST /api/channels/:channelId/threads/:threadId/responses',
        action: `send a Thread Response in a ${CHANNEL_KIND_NAME[channel]} channel`,
        channel,
        thread: true,
        request: (ctx) => ({
          path: `${threadPath(ctx)}/responses`,
          method: 'POST',
          body: { body: doc('On my way.') },
        }),
      },
      membershipChange(channel, 201, (actor) => CHANNEL_ROLE[actor] !== null),
    ),
  ),

  // Read a Thread's Thread Responses: anyone who can read the Channel.
  ...CHANNEL_KINDS.flatMap((channel) =>
    rowsFor(
      {
        route: 'GET /api/channels/:channelId/threads/:threadId/responses',
        action: `read the Thread Responses of a Thread in a ${CHANNEL_KIND_NAME[channel]} channel`,
        channel,
        thread: true,
        response: true,
        request: (ctx) => ({ path: `${threadPath(ctx)}/responses` }),
      },
      readsChannel(channel),
    ),
  ),

  // Edit and delete a Thread, and a Thread Response: the author, or a company Admin in a
  // Channel they can read.
  ...CHANNEL_KINDS.flatMap((channel) => [
    ...rowsFor(
      {
        route: 'PATCH /api/channels/:channelId/threads/:threadId',
        action: `edit a Thread in a ${CHANNEL_KIND_NAME[channel]} channel`,
        channel,
        thread: true,
        request: (ctx) => ({
          path: threadPath(ctx),
          method: 'PATCH',
          body: { title: 'Heater fixed', body: doc('Done.') },
        }),
      },
      contentChange(channel, 'edit', 200),
    ),
    ...rowsFor(
      {
        route: 'DELETE /api/channels/:channelId/threads/:threadId',
        action: `delete a Thread in a ${CHANNEL_KIND_NAME[channel]} channel`,
        channel,
        thread: true,
        response: true,
        request: (ctx) => ({ path: threadPath(ctx), method: 'DELETE' }),
      },
      contentChange(channel, 'delete', 204),
    ),
    ...rowsFor(
      {
        route: 'PATCH /api/channels/:channelId/threads/:threadId/responses/:threadResponseId',
        action: `edit a Thread Response in a ${CHANNEL_KIND_NAME[channel]} channel`,
        channel,
        thread: true,
        response: true,
        request: (ctx) => ({
          path: `${threadPath(ctx)}/responses/${ctx.response?.id}`,
          method: 'PATCH',
          body: { body: doc('Fixed now.') },
        }),
      },
      contentChange(channel, 'edit', 200),
    ),
    ...rowsFor(
      {
        route: 'DELETE /api/channels/:channelId/threads/:threadId/responses/:threadResponseId',
        action: `delete a Thread Response in a ${CHANNEL_KIND_NAME[channel]} channel`,
        channel,
        thread: true,
        response: true,
        request: (ctx) => ({
          path: `${threadPath(ctx)}/responses/${ctx.response?.id}`,
          method: 'DELETE',
        }),
      },
      contentChange(channel, 'delete', 204),
    ),
  ]),

  // Reactions. From "Reactions" (#40).

  // React to a Thread or a Thread Response, and take a reaction back: Channel members
  // only, company Admins included. A non-member of a Public channel must join first
  // (403); a Private channel they aren't in is hidden (404). Nobody reacts in an
  // Archived channel.
  ...CHANNEL_KINDS.flatMap((channel) => {
    const reacts = membershipChange(channel, 200, (actor) => CHANNEL_ROLE[actor] !== null);
    return [
      ...rowsFor(
        {
          route: 'PUT /api/channels/:channelId/threads/:threadId/reactions/:emoji',
          action: `react to a Thread in a ${CHANNEL_KIND_NAME[channel]} channel`,
          channel,
          thread: true,
          request: (ctx) => ({
            path: `${threadPath(ctx)}/reactions/${encodeURIComponent('👍')}`,
            method: 'PUT',
          }),
        },
        reacts,
      ),
      ...rowsFor(
        {
          route: 'DELETE /api/channels/:channelId/threads/:threadId/reactions/:emoji',
          action: `take back a reaction to a Thread in a ${CHANNEL_KIND_NAME[channel]} channel`,
          channel,
          thread: true,
          request: (ctx) => ({
            path: `${threadPath(ctx)}/reactions/${encodeURIComponent('👍')}`,
            method: 'DELETE',
          }),
        },
        reacts,
      ),
      ...rowsFor(
        {
          route:
            'PUT /api/channels/:channelId/threads/:threadId/responses/:threadResponseId/reactions/:emoji',
          action: `react to a Thread Response in a ${CHANNEL_KIND_NAME[channel]} channel`,
          channel,
          thread: true,
          response: true,
          request: (ctx) => ({
            path: `${threadPath(ctx)}/responses/${ctx.response?.id}/reactions/${encodeURIComponent('🎉')}`,
            method: 'PUT',
          }),
        },
        reacts,
      ),
      ...rowsFor(
        {
          route:
            'DELETE /api/channels/:channelId/threads/:threadId/responses/:threadResponseId/reactions/:emoji',
          action: `take back a reaction to a Thread Response in a ${CHANNEL_KIND_NAME[channel]} channel`,
          channel,
          thread: true,
          response: true,
          request: (ctx) => ({
            path: `${threadPath(ctx)}/responses/${ctx.response?.id}/reactions/${encodeURIComponent('🎉')}`,
            method: 'DELETE',
          }),
        },
        reacts,
      ),
    ];
  }),

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

  // Pings. From "Pings and Acknowledge" (#46).

  // The Pings view and its counts: anyone lists their own.
  ...rowsFor(
    {
      route: 'GET /api/pings',
      action: 'list their own Pings',
      channel: null,
      request: () => ({ path: '/api/pings' }),
    },
    allowed(200),
  ),
  ...rowsFor(
    {
      route: 'GET /api/pings/summary',
      action: 'count their own Pings',
      channel: null,
      request: () => ({ path: '/api/pings/summary' }),
    },
    allowed(200),
  ),

  // Mark a Thread read: anyone who can read it, non-members of a Public channel included.
  // A Private channel they aren't in is hidden (404).
  ...CHANNEL_KINDS.flatMap((channel) =>
    rowsFor(
      {
        route: 'DELETE /api/channels/:channelId/threads/:threadId/ping',
        action: `mark a Thread read in a ${CHANNEL_KIND_NAME[channel]} channel`,
        channel,
        thread: true,
        request: (ctx) => ({ path: `${threadPath(ctx)}/ping`, method: 'DELETE' }),
      },
      (actor) => {
        const read = readsChannel(channel)(actor);
        return read.allow ? { allow: true, status: 204 } : read;
      },
    ),
  ),

  // The Saved view: everyone lists their own.
  ...rowsFor(
    {
      route: 'GET /api/saved',
      action: 'list their own Saved Threads',
      channel: null,
      request: () => ({ path: '/api/saved' }),
    },
    allowed(200),
  ),

  // Save a Thread, remove it from Saved, and mute or unmute a Thread: anyone who can read
  // it, non-members of a Public channel included. A Private channel they aren't in is
  // hidden (404).
  ...(
    [
      ['PUT', 'saved', 'Save a Thread'],
      ['DELETE', 'saved', 'remove a Thread from Saved'],
      ['PUT', 'mute', 'mute a Thread'],
      ['DELETE', 'mute', 'unmute a Thread'],
    ] as const
  ).flatMap(([method, segment, action]) =>
    CHANNEL_KINDS.flatMap((channel) =>
      rowsFor(
        {
          route: `${method} /api/channels/:channelId/threads/:threadId/${segment}`,
          action: `${action} in a ${CHANNEL_KIND_NAME[channel]} channel`,
          channel,
          thread: true,
          request: (ctx) => ({ path: `${threadPath(ctx)}/${segment}`, method }),
        },
        (actor) => {
          const read = readsChannel(channel)(actor);
          return read.allow ? { allow: true, status: 204 } : read;
        },
      ),
    ),
  ),

  // Mute or unmute a whole Channel: its members, Archived channels included. A Public
  // channel's non-members are refused (403), company Admins included; a Private channel
  // they aren't in is hidden (404).
  ...(['PUT', 'DELETE'] as const).flatMap((method) =>
    CHANNEL_KINDS.flatMap((channel) =>
      rowsFor(
        {
          route: `${method} /api/channels/:channelId/mute`,
          action: `${method === 'PUT' ? 'mute' : 'unmute'} a ${CHANNEL_KIND_NAME[channel]} channel`,
          channel,
          request: (ctx) => ({ path: `/api/channels/${ctx.channel?.id}/mute`, method }),
        },
        placesChannel(channel),
      ),
    ),
  ),

  // Resolve an open Thread, and reopen a Resolved one, under both "Who can resolve
  // threads?" settings. From "Resolve, reopen and Thread list controls" (#41).
  ...CHANNEL_KINDS.flatMap((channel) =>
    (['any_member', 'author_and_channel_admins'] as const).flatMap((resolvePolicy) => {
      const setting = resolvePolicy === 'any_member' ? 'any member' : 'author and Channel admins';
      return [
        ...rowsFor(
          {
            route: 'PUT /api/channels/:channelId/threads/:threadId/resolved',
            action: `resolve a Thread in a ${CHANNEL_KIND_NAME[channel]} channel where ${setting} may`,
            channel,
            resolvePolicy,
            thread: true,
            request: (ctx) => ({ path: `${threadPath(ctx)}/resolved`, method: 'PUT' }),
          },
          resolveChange(channel, resolvePolicy),
        ),
        ...rowsFor(
          {
            route: 'DELETE /api/channels/:channelId/threads/:threadId/resolved',
            action: `reopen a Thread in a ${CHANNEL_KIND_NAME[channel]} channel where ${setting} may`,
            channel,
            resolvePolicy,
            thread: 'resolved',
            request: (ctx) => ({ path: `${threadPath(ctx)}/resolved`, method: 'DELETE' }),
          },
          resolveChange(channel, resolvePolicy),
        ),
      ];
    }),
  ),

  // Open the live-update stream: every active Staff member. What reaches it is decided
  // per event, in lib/sse/routes.int.test.ts.
  ...rowsFor(
    {
      route: 'GET /api/live',
      action: 'open the live-update stream',
      channel: null,
      request: () => ({ path: '/api/live' }),
    },
    allowed(200),
  ),

  // Sidebar Sections. From "Sidebar Sections" (#44). Everyone manages their own; another
  // Staff member's Section is hidden by row-level security, so it answers 404.
  ...rowsFor(
    {
      route: 'GET /api/sections',
      action: 'list their own Sections',
      channel: null,
      request: () => ({ path: '/api/sections' }),
    },
    allowed(200),
  ),
  ...rowsFor(
    {
      route: 'POST /api/sections',
      action: 'create a Section',
      channel: null,
      request: () => ({ path: '/api/sections', method: 'POST', body: { name: 'Teaching' } }),
    },
    allowed(201),
  ),
  ...rowsFor(
    {
      route: 'PUT /api/sections/order',
      action: 'reorder their own Sections',
      channel: null,
      section: 'own',
      request: (ctx) => ({
        path: '/api/sections/order',
        method: 'PUT',
        body: { sectionIds: [ctx.section?.id] },
      }),
    },
    allowed(200),
  ),
  ...rowsFor(
    {
      route: 'PUT /api/sections/order',
      action: 'reorder with another Staff member’s Section',
      channel: null,
      section: 'other',
      request: (ctx) => ({
        path: '/api/sections/order',
        method: 'PUT',
        body: { sectionIds: [ctx.section?.id] },
      }),
    },
    hiddenSection,
  ),
  ...(['own', 'other'] as const).flatMap((section) => [
    ...rowsFor(
      {
        route: 'PATCH /api/sections/:sectionId',
        action: `rename ${section === 'own' ? 'their own' : 'another Staff member’s'} Section`,
        channel: null,
        section,
        request: (ctx) => ({
          path: `/api/sections/${ctx.section?.id}`,
          method: 'PATCH',
          body: { name: 'Renamed', collapsed: true },
        }),
      },
      section === 'own' ? allowed(200) : hiddenSection,
    ),
    ...rowsFor(
      {
        route: 'DELETE /api/sections/:sectionId',
        action: `delete ${section === 'own' ? 'their own' : 'another Staff member’s'} Section`,
        channel: null,
        section,
        request: (ctx) => ({ path: `/api/sections/${ctx.section?.id}`, method: 'DELETE' }),
      },
      section === 'own' ? allowed(204) : hiddenSection,
    ),
  ]),

  // Move a Channel into a Section: its members, in any Channel they're in, Archived
  // included. A Private channel they aren't in is hidden (404); a Public one they haven't
  // joined is refused (403).
  ...CHANNEL_KINDS.flatMap((channel) =>
    rowsFor(
      {
        route: 'PUT /api/channels/:channelId/section',
        action: `put a ${CHANNEL_KIND_NAME[channel]} channel in their own Section`,
        channel,
        section: 'own',
        request: (ctx) => ({
          path: `/api/channels/${ctx.channel?.id}/section`,
          method: 'PUT',
          body: { sectionId: ctx.section?.id },
        }),
      },
      placesChannel(channel),
    ),
  ),
  ...rowsFor(
    {
      route: 'PUT /api/channels/:channelId/section',
      action: 'move a Public channel back to the default Channels section',
      channel: 'public',
      request: (ctx) => ({
        path: `/api/channels/${ctx.channel?.id}/section`,
        method: 'PUT',
        body: { sectionId: null },
      }),
    },
    placesChannel('public'),
  ),
  ...rowsFor(
    {
      route: 'PUT /api/channels/:channelId/section',
      action: 'put a Public channel in another Staff member’s Section',
      channel: 'public',
      section: 'other',
      request: (ctx) => ({
        path: `/api/channels/${ctx.channel?.id}/section`,
        method: 'PUT',
        body: { sectionId: ctx.section?.id },
      }),
    },
    (actor) =>
      CHANNEL_ROLE[actor] ? { allow: false, status: 404 } : { allow: false, status: 403 },
  ),

  // Mentions. From "Mentions" (#49).

  // The @ picker's list: anyone who can read the Channel.
  ...CHANNEL_KINDS.flatMap((channel) =>
    rowsFor(
      {
        route: 'GET /api/channels/:channelId/mention-candidates',
        action: `list who can be Mentioned in a ${CHANNEL_KIND_NAME[channel]} channel`,
        channel,
        request: (ctx) => ({ path: `/api/channels/${ctx.channel?.id}/mention-candidates` }),
      },
      readsChannel(channel),
    ),
  ),

  // Mention validation: only Staff members who can read the Thread can be Mentioned. In a
  // Public channel that's a non-member too; in a Private one, only its members.
  ...rowsFor(
    {
      route: 'POST /api/channels/:channelId/threads',
      action: 'start a Thread Mentioning a non-member of a Public channel',
      channel: 'public',
      target: 'active',
      request: (ctx) => ({
        path: `/api/channels/${ctx.channel?.id}/threads`,
        method: 'POST',
        body: { title: 'Heater broken in room 2', body: mentionDoc(ctx.target?.id) },
      }),
    },
    membershipChange('public', 201, (actor) => CHANNEL_ROLE[actor] !== null),
  ),
  ...rowsFor(
    {
      route: 'POST /api/channels/:channelId/threads',
      action: 'start a Thread Mentioning a member of a Private channel',
      channel: 'private',
      target: 'member',
      request: (ctx) => ({
        path: `/api/channels/${ctx.channel?.id}/threads`,
        method: 'POST',
        body: { title: 'Heater broken in room 2', body: mentionDoc(ctx.target?.id) },
      }),
    },
    membershipChange('private', 201, (actor) => CHANNEL_ROLE[actor] !== null),
  ),
  ...rowsFor(
    {
      route: 'POST /api/channels/:channelId/threads',
      action: 'start a Thread Mentioning a non-member of a Private channel',
      channel: 'private',
      target: 'active',
      request: (ctx) => ({
        path: `/api/channels/${ctx.channel?.id}/threads`,
        method: 'POST',
        body: { title: 'Heater broken in room 2', body: mentionDoc(ctx.target?.id) },
      }),
    },
    membershipChange('private', 201, () => false),
  ),
  ...(['invited', 'deactivated'] as const).flatMap((target) =>
    rowsFor(
      {
        route: 'POST /api/channels/:channelId/threads',
        action: `start a Thread Mentioning ${target === 'invited' ? 'an Invited' : 'a Deactivated'} Staff member`,
        channel: 'public',
        target,
        request: (ctx) => ({
          path: `/api/channels/${ctx.channel?.id}/threads`,
          method: 'POST',
          body: { title: 'Heater broken in room 2', body: mentionDoc(ctx.target?.id) },
        }),
      },
      membershipChange('public', 201, () => false),
    ),
  ),
  ...(['public', 'private'] as const).flatMap((channel) =>
    rowsFor(
      {
        route: 'POST /api/channels/:channelId/threads/:threadId/responses',
        action: `send a Thread Response Mentioning a non-member of a ${CHANNEL_KIND_NAME[channel]} channel`,
        channel,
        target: 'active',
        thread: true,
        request: (ctx) => ({
          path: `${threadPath(ctx)}/responses`,
          method: 'POST',
          body: { body: mentionDoc(ctx.target?.id) },
        }),
      },
      membershipChange(
        channel,
        201,
        (actor) => channel === 'public' && CHANNEL_ROLE[actor] !== null,
      ),
    ),
  ),
  ...(['public', 'private'] as const).flatMap((channel) =>
    rowsFor(
      {
        route: 'PATCH /api/channels/:channelId/threads/:threadId/responses/:threadResponseId',
        action: `edit a Thread Response to Mention a non-member of a ${CHANNEL_KIND_NAME[channel]} channel`,
        channel,
        target: 'active',
        thread: true,
        response: true,
        request: (ctx) => ({
          path: `${threadPath(ctx)}/responses/${ctx.response?.id}`,
          method: 'PATCH',
          body: { body: mentionDoc(ctx.target?.id) },
        }),
      },
      (actor) => {
        const edit = contentChange(channel, 'edit', 200)(actor);
        return channel === 'private' && edit.allow ? { allow: false, status: 403 } : edit;
      },
    ),
  ),
  ...(['public', 'private'] as const).flatMap((channel) =>
    rowsFor(
      {
        route: 'PATCH /api/channels/:channelId/threads/:threadId',
        action: `edit a Thread to Mention a non-member of a ${CHANNEL_KIND_NAME[channel]} channel`,
        channel,
        target: 'active',
        thread: true,
        request: (ctx) => ({
          path: threadPath(ctx),
          method: 'PATCH',
          body: { title: 'Heater broken in room 2', body: mentionDoc(ctx.target?.id) },
        }),
      },
      (actor) => {
        const edit = contentChange(channel, 'edit', 200)(actor);
        return channel === 'private' && edit.allow ? { allow: false, status: 403 } : edit;
      },
    ),
  ),
];

/** Every route the matrix covers, for the route-coverage guard. */
export function coveredRoutes(rows: readonly MatrixRow[] = MATRIX): Set<RouteKey> {
  return new Set(rows.map((row) => row.route));
}
