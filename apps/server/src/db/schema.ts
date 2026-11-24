// Ping's tables, as Drizzle sees them. drizzle-kit generates the table DDL from this file.
// Roles, grants, row-level security and policies live in hand-written SQL migrations,
// because Drizzle doesn't emit FORCE ROW LEVEL SECURITY (ADR 0004).

import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// --- Better Auth tables. Owned by the auth module; no row-level security (data-model.md).

export const user = pgTable('user', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const session = pgTable(
  'session',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [index('session_user_id_idx').on(t.userId)],
);

export const account = pgTable(
  'account',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('account_user_id_idx').on(t.userId)],
);

export const verification = pgTable(
  'verification',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
);

// --- Ping's own tables. Every one has forced row-level security and explicit policies.

export const staffRole = pgEnum('staff_role', ['admin', 'member']);

export const staffMember = pgTable(
  'staff_member',
  {
    // Shares its key with Better Auth's user row.
    id: uuid('id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: staffRole('role').notNull().default('member'),
    createdAt: createdAt(),
    invitedBy: uuid('invited_by').references((): AnyPgColumn => staffMember.id),
    // Null while Invited.
    joinedAt: timestamp('joined_at', { withTimezone: true }),
    deactivatedAt: timestamp('deactivated_at', { withTimezone: true }),
    deactivatedBy: uuid('deactivated_by').references((): AnyPgColumn => staffMember.id),
  },
  (t) => [
    check(
      'staff_member_deactivated_by_with_at',
      sql`(${t.deactivatedAt} is null) = (${t.deactivatedBy} is null)`,
    ),
  ],
);

/**
 * The live invite of an Invited Staff member: one row per person (data-model.md › Auth and
 * Staff members). Only the token's SHA-256 is stored. Resend replaces the hash and expiry;
 * accepting deletes the row; Cancel deletes it with the person.
 */
export const staffInvite = pgTable('staff_invite', {
  staffId: uuid('staff_id')
    .primaryKey()
    .references(() => staffMember.id),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  // Null for the bootstrap Admin's invite, which no Staff member sent.
  createdBy: uuid('created_by').references(() => staffMember.id),
  createdAt: createdAt(),
  // Set when the invite email couldn't be sent; cleared by Resend.
  emailFailedAt: timestamp('email_failed_at', { withTimezone: true }),
});

export const channelVisibility = pgEnum('channel_visibility', ['public', 'private']);
export const resolvePolicy = pgEnum('resolve_policy', ['any_member', 'author_and_channel_admins']);

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

/**
 * A Channel. Created only through the create_channel system function, which inserts its
 * first Channel admin in the same statement (data-model.md › Channels). Never deleted.
 */
export const channel = pgTable(
  'channel',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    visibility: channelVisibility('visibility').notNull(),
    resolvePolicy: resolvePolicy('resolve_policy').notNull().default('any_member'),
    createdAt: createdAt(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => staffMember.id),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    archivedBy: uuid('archived_by').references(() => staffMember.id),
    search: tsvector('search').generatedAlwaysAs(
      sql`to_tsvector('english', name || ' ' || description)`,
    ),
  },
  (t) => [
    index('channel_search_idx').using('gin', t.search),
    check(
      'channel_archived_by_with_at',
      sql`(${t.archivedAt} is null) = (${t.archivedBy} is null)`,
    ),
  ],
);

/** An active Channel member. Leaving or being removed deletes the row. */
export const channelMember = pgTable(
  'channel_member',
  {
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channel.id),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staffMember.id),
    isChannelAdmin: boolean('is_channel_admin').notNull().default(false),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.channelId, t.staffId] }),
    index('channel_member_staff_id_idx').on(t.staffId),
  ],
);

/** Why Ping started a System thread (product.md › System threads). */
export const systemThreadKind = pgEnum('system_thread_kind', [
  'channel_made_private',
  'channel_archived',
  'channel_admin_replaced',
]);

/**
 * A Thread (data-model.md › Threads and Thread Responses). A System thread has no author
 * and has a kind and a payload of Staff member IDs; an ordinary Thread is the other way
 * round. The body is ProseMirror JSON on the allowlist; body_text is extracted by the
 * server on every save (ADR 0003). Threads never move between Channels, so child rows
 * copy channel_id under a composite foreign key to (id, channel_id).
 */
export const thread = pgTable(
  'thread',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channel.id),
    authorId: uuid('author_id').references(() => staffMember.id),
    isSystem: boolean('is_system').notNull().default(false),
    systemKind: systemThreadKind('system_kind'),
    systemPayload: jsonb('system_payload'),
    title: text('title').notNull(),
    body: jsonb('body').notNull(),
    bodyText: text('body_text').notNull(),
    createdAt: createdAt(),
    // Only moves forward: starts at created_at, then each new Thread Response's created_at.
    latestActivityAt: timestamp('latest_activity_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    editedBy: uuid('edited_by').references(() => staffMember.id),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolvedBy: uuid('resolved_by').references(() => staffMember.id),
    search: tsvector('search').generatedAlwaysAs(
      sql`to_tsvector('english', title || ' ' || body_text)`,
    ),
  },
  (t) => [
    unique('thread_id_channel_id_unique').on(t.id, t.channelId),
    index('thread_channel_id_latest_activity_at_idx').on(t.channelId, t.latestActivityAt),
    index('thread_channel_id_created_at_idx').on(t.channelId, t.createdAt),
    index('thread_search_idx').using('gin', t.search),
    check(
      'thread_system_or_authored',
      sql`(${t.isSystem} and ${t.authorId} is null and ${t.systemKind} is not null and ${t.systemPayload} is not null)
        or (not ${t.isSystem} and ${t.authorId} is not null and ${t.systemKind} is null and ${t.systemPayload} is null)`,
    ),
    check('thread_edited_by_with_at', sql`(${t.editedAt} is null) = (${t.editedBy} is null)`),
    check('thread_resolved_by_with_at', sql`(${t.resolvedAt} is null) = (${t.resolvedBy} is null)`),
  ],
);

/**
 * A Thread Response (data-model.md › Threads and Thread Responses). Deleting one keeps
 * the row as the "Thread Response deleted" placeholder with its body and body_text
 * nulled. The composite foreign key keeps the copied channel_id in step with its Thread,
 * and deleting the Thread cascades here.
 */
export const threadResponse = pgTable(
  'thread_response',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    threadId: uuid('thread_id').notNull(),
    channelId: uuid('channel_id').notNull(),
    authorId: uuid('author_id')
      .notNull()
      .references(() => staffMember.id),
    body: jsonb('body'),
    bodyText: text('body_text'),
    createdAt: createdAt(),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    editedBy: uuid('edited_by').references(() => staffMember.id),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    deletedBy: uuid('deleted_by').references(() => staffMember.id),
    search: tsvector('search').generatedAlwaysAs(
      sql`to_tsvector('english', coalesce(body_text, ''))`,
    ),
  },
  (t) => [
    unique('thread_response_id_channel_id_unique').on(t.id, t.channelId),
    foreignKey({
      name: 'thread_response_thread_fk',
      columns: [t.threadId, t.channelId],
      foreignColumns: [thread.id, thread.channelId],
    }).onDelete('cascade'),
    index('thread_response_thread_id_created_at_idx').on(t.threadId, t.createdAt),
    index('thread_response_search_idx').using('gin', t.search),
    check(
      'thread_response_body_unless_deleted',
      sql`(${t.deletedAt} is null and ${t.body} is not null and ${t.bodyText} is not null)
        or (${t.deletedAt} is not null and ${t.body} is null and ${t.bodyText} is null)`,
    ),
    check(
      'thread_response_edited_by_with_at',
      sql`(${t.editedAt} is null) = (${t.editedBy} is null)`,
    ),
    check(
      'thread_response_deleted_by_with_at',
      sql`(${t.deletedAt} is null) = (${t.deletedBy} is null)`,
    ),
  ],
);

/**
 * A reaction to a Thread or a Thread Response (data-model.md › On Threads and Thread
 * Responses): one Unicode emoji by one Staff member. Exactly one target is set, checked
 * here, and each Staff member reacts once per emoji per target, enforced by a partial
 * unique index per target. Both targets copy channel_id under a composite foreign key,
 * and deleting a Thread cascades to its reactions, directly and through its Thread
 * Responses. A deleted Thread Response keeps its row as a placeholder, so its reactions
 * are deleted by the route that deletes it.
 */
export const reaction = pgTable(
  'reaction',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    channelId: uuid('channel_id').notNull(),
    threadId: uuid('thread_id'),
    threadResponseId: uuid('thread_response_id'),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staffMember.id),
    emoji: text('emoji').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'reaction_thread_fk',
      columns: [t.threadId, t.channelId],
      foreignColumns: [thread.id, thread.channelId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'reaction_thread_response_fk',
      columns: [t.threadResponseId, t.channelId],
      foreignColumns: [threadResponse.id, threadResponse.channelId],
    }).onDelete('cascade'),
    check(
      'reaction_exactly_one_target',
      sql`(${t.threadId} is not null) <> (${t.threadResponseId} is not null)`,
    ),
    uniqueIndex('reaction_thread_staff_emoji_unique')
      .on(t.threadId, t.staffId, t.emoji)
      .where(sql`${t.threadId} is not null`),
    uniqueIndex('reaction_thread_response_staff_emoji_unique')
      .on(t.threadResponseId, t.staffId, t.emoji)
      .where(sql`${t.threadResponseId} is not null`),
  ],
);

/**
 * A Mention in a Thread or a Thread Response (data-model.md › On Threads and Thread
 * Responses): one Staff member named with @ in its body. Rebuilt from the body's Mention
 * nodes on every save, by adding the newly Mentioned and dropping the rest, so `created_at`
 * is when each person was first Mentioned there; the fan-out Pings the rows created in its
 * own transaction. Exactly one target is set, and each person is Mentioned once per target.
 * Deleting a Thread cascades here; deleting a Thread Response keeps its placeholder row, so
 * the route that deletes it removes its Mentions.
 */
export const mention = pgTable(
  'mention',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    channelId: uuid('channel_id').notNull(),
    threadId: uuid('thread_id'),
    threadResponseId: uuid('thread_response_id'),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staffMember.id),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: 'mention_thread_fk',
      columns: [t.threadId, t.channelId],
      foreignColumns: [thread.id, thread.channelId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'mention_thread_response_fk',
      columns: [t.threadResponseId, t.channelId],
      foreignColumns: [threadResponse.id, threadResponse.channelId],
    }).onDelete('cascade'),
    check(
      'mention_exactly_one_target',
      sql`(${t.threadId} is not null) <> (${t.threadResponseId} is not null)`,
    ),
    uniqueIndex('mention_thread_staff_unique')
      .on(t.threadId, t.staffId)
      .where(sql`${t.threadId} is not null`),
    uniqueIndex('mention_thread_response_staff_unique')
      .on(t.threadResponseId, t.staffId)
      .where(sql`${t.threadResponseId} is not null`),
    // "@You" on Thread rows looks up a Staff member's Mentions.
    index('mention_staff_id_idx').on(t.staffId),
  ],
);

/**
 * A Ping (data-model.md › Attention): one Staff member's open notice of other people's new
 * activity in one Thread, with a count. A row exists only while the Ping is open; the
 * fan-out upserts it and Acknowledging deletes it. Deleting the Thread cascades here, but
 * deleting a Thread Response changes nothing.
 */
export const ping = pgTable(
  'ping',
  {
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staffMember.id),
    threadId: uuid('thread_id').notNull(),
    channelId: uuid('channel_id').notNull(),
    count: integer('count').notNull().default(1),
    firstAt: timestamp('first_at', { withTimezone: true }).notNull().defaultNow(),
    lastAt: timestamp('last_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.staffId, t.threadId] }),
    index('ping_staff_id_last_at_idx').on(t.staffId, t.lastAt),
    foreignKey({
      name: 'ping_thread_fk',
      columns: [t.threadId, t.channelId],
      foreignColumns: [thread.id, thread.channelId],
    }).onDelete('cascade'),
    check('ping_count_positive', sql`${t.count} >= 1`),
  ],
);

/**
 * A Thread on a Staff member's Saved list (data-model.md › Attention). Removing it from
 * Saved deletes the row; deleting the Thread takes it with it.
 */
export const savedThread = pgTable(
  'saved_thread',
  {
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staffMember.id),
    threadId: uuid('thread_id').notNull(),
    channelId: uuid('channel_id').notNull(),
    savedAt: timestamp('saved_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.staffId, t.threadId] }),
    index('saved_thread_staff_id_saved_at_idx').on(t.staffId, t.savedAt),
    foreignKey({
      name: 'saved_thread_thread_fk',
      columns: [t.threadId, t.channelId],
      foreignColumns: [thread.id, thread.channelId],
    }).onDelete('cascade'),
  ],
);

/**
 * A Staff member's Mute of a whole Channel (`threadId` null) or of one Thread in it
 * (data-model.md › Attention). At most one of each, so the null counts as a value.
 */
export const mute = pgTable(
  'mute',
  {
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staffMember.id),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channel.id),
    threadId: uuid('thread_id'),
  },
  (t) => [
    unique('mute_staff_id_channel_id_thread_id_unique')
      .on(t.staffId, t.channelId, t.threadId)
      .nullsNotDistinct(),
    foreignKey({
      name: 'mute_thread_fk',
      columns: [t.threadId, t.channelId],
      foreignColumns: [thread.id, thread.channelId],
    }).onDelete('cascade'),
  ],
);

/**
 * A Section (data-model.md › Sidebar Sections): a named group of Channels in one Staff
 * member's sidebar. Visible only to its owner. Unique on (id, staff_id) so section_channel
 * can tie a placement to a Section of the same owner.
 */
export const section = pgTable(
  'section',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staffMember.id),
    name: text('name').notNull(),
    position: integer('position').notNull(),
    collapsed: boolean('collapsed').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    unique('section_id_staff_id_unique').on(t.id, t.staffId),
    index('section_staff_id_position_idx').on(t.staffId, t.position),
  ],
);

/**
 * Where a Staff member placed a Channel in their sidebar. A Channel with no row sits in the
 * default Channels section. The composite foreign key keeps a placement in a Section of its
 * own owner (foreign key checks bypass row-level security), and deleting a Section cascades
 * here, which moves its Channels back to the default section. Leaving a Channel, or losing
 * access to it, deletes the row (clean_up_lost_access).
 */
export const sectionChannel = pgTable(
  'section_channel',
  {
    staffId: uuid('staff_id')
      .notNull()
      .references(() => staffMember.id),
    channelId: uuid('channel_id')
      .notNull()
      .references(() => channel.id),
    sectionId: uuid('section_id').notNull(),
    position: integer('position').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.staffId, t.channelId] }),
    index('section_channel_section_id_idx').on(t.sectionId),
    foreignKey({
      name: 'section_channel_section_fk',
      columns: [t.sectionId, t.staffId],
      foreignColumns: [section.id, section.staffId],
    }).onDelete('cascade'),
  ],
);

/** Every kind of audit_event. Later slices add the rest. */
export type AuditEventKind =
  | 'sign_in_succeeded'
  | 'sign_in_failed'
  | 'staff_invited'
  | 'staff_invite_resent'
  | 'staff_invite_cancelled'
  | 'email_change_requested'
  | 'email_changed'
  | 'staff_role_changed'
  | 'staff_deactivated'
  | 'staff_reactivated'
  | 'channel_joined'
  | 'channel_left'
  | 'channel_member_added'
  | 'channel_member_removed'
  | 'channel_admin_appointed'
  | 'channel_admin_removed'
  // A company Admin edited or deleted someone else's content. target_staff_id is its
  // author; channel_id its Channel.
  | 'admin_edited_thread'
  | 'admin_deleted_thread'
  | 'admin_edited_thread_response'
  | 'admin_deleted_thread_response';

/**
 * Security-relevant actions, kept for one year. Never holds message bodies or email
 * addresses. `actor_id` is null for system actions and failed sign-ins.
 */
export const auditEvent = pgTable(
  'audit_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: createdAt(),
    actorId: uuid('actor_id').references(() => staffMember.id),
    kind: text('kind').$type<AuditEventKind>().notNull(),
    // No foreign key: the record outlives a cancelled invite's staff_member row.
    targetStaffId: uuid('target_staff_id'),
    // The Channel a membership change happened in. No foreign key, like target_staff_id.
    channelId: uuid('channel_id'),
    ipAddress: text('ip_address'),
  },
  (t) => [index('audit_event_created_at_idx').on(t.createdAt)],
);
