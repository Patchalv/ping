import { expect } from 'vitest';
import {
  asOwner,
  createInvitedStaffMember,
  createStaffMember,
  databaseSnapshot,
  insertAttachment,
  insertChannel,
  insertThread,
  insertThreadResponse,
} from '../../db/test-support';
import { formHeaders, jsonHeaders, type TestApp } from '../test-app';
import { CHANNEL_ROLE, createActor } from './actors';
import type { ChannelKind, MatrixRow, RowContext } from './matrix';

/**
 * Creates the row's Channel and the actor's relationship to it (author, Channel admin,
 * member, or none).
 */
type ChannelFixtures = (
  kind: ChannelKind,
  ctx: Pick<RowContext, 'actor'>,
  resolvePolicy: MatrixRow['resolvePolicy'],
) => Promise<{ id: string }>;

/**
 * The standard Channel fixtures. Every Channel has a Channel admin: the actor, when they
 * are the Channel admin, or else a fresh Staff member. `archived` is Public;
 * `archivedPrivate` is Private.
 */
const channelFixtures: ChannelFixtures = async (kind, { actor }, resolvePolicy) => {
  const role = CHANNEL_ROLE[actor.kind];
  const members =
    role === 'channelAdmin'
      ? [{ staffId: actor.staff.id, channelAdmin: true }]
      : [
          { staffId: (await createStaffMember()).id, channelAdmin: true },
          ...(role === 'member' ? [{ staffId: actor.staff.id }] : []),
        ];
  return insertChannel({
    visibility: kind === 'private' || kind === 'archivedPrivate' ? 'private' : 'public',
    archived: kind === 'archived' || kind === 'archivedPrivate',
    ...(resolvePolicy ? { resolvePolicy } : {}),
    members,
  });
};

/**
 * The row's target Staff member, by kind. The in-Channel kinds join the row's Channel as
 * a plain member or as a second active Channel admin, so changing them never touches the
 * last one; `self` is the actor.
 */
const targetFixtures: Record<
  NonNullable<MatrixRow['target']>,
  (ctx: Pick<RowContext, 'actor' | 'channel'>) => Promise<{ id: string }>
> = {
  invited: () => createInvitedStaffMember(),
  active: () => createStaffMember(),
  deactivated: () => createStaffMember({ deactivated: true }),
  self: async ({ actor }) => actor.staff,
  member: ({ channel }) => joinedTarget(channel, false),
  channelAdmin: ({ channel }) => joinedTarget(channel, true),
};

/** A fresh Staff member in the row's Channel, inserted as the owner. */
async function joinedTarget(channel: { id: string } | undefined, channelAdmin: boolean) {
  if (!channel) throw new Error('An in-Channel target needs a row with a Channel');
  const staff = await createStaffMember();
  await asOwner((query) =>
    query(
      'insert into channel_member (channel_id, staff_id, is_channel_admin) values ($1, $2, $3)',
      [channel.id, staff.id, channelAdmin],
    ),
  );
  return staff;
}

/**
 * The row's Thread, in its Channel, open or Resolved. The author actor started it; for
 * every other actor, a fresh member of the Channel did.
 */
async function threadFixture(
  { actor, channel }: Pick<RowContext, 'actor' | 'channel'>,
  kind: NonNullable<MatrixRow['thread']>,
) {
  if (!channel) throw new Error('A Thread needs a row with a Channel');
  const authorId =
    actor.kind === 'author' ? actor.staff.id : (await joinedTarget(channel, false)).id;
  return insertThread({ channelId: channel.id, authorId, resolved: kind === 'resolved' });
}

/**
 * The row's Thread Response, in its Thread. The author actor sent it; for every other
 * actor, a fresh member of the Channel did.
 */
async function responseFixture({
  actor,
  channel,
  thread,
}: Pick<RowContext, 'actor' | 'channel' | 'thread'>) {
  if (!channel || !thread) throw new Error('A Thread Response needs a row with a Thread');
  const authorId =
    actor.kind === 'author' ? actor.staff.id : (await joinedTarget(channel, false)).id;
  return insertThreadResponse({ threadId: thread.id, channelId: channel.id, authorId });
}

/** The row's Sidebar Section: the actor's own, or a fresh Staff member's. */
async function sectionFixture(
  kind: NonNullable<MatrixRow['section']>,
  { actor }: Pick<RowContext, 'actor'>,
) {
  const staffId = kind === 'own' ? actor.staff.id : (await createStaffMember()).id;
  return asOwner(async (query) => {
    const result = await query<{ id: string }>(
      `insert into section (staff_id, name, position) values ($1, 'Teaching', 0) returning id`,
      [staffId],
    );
    const row = result.rows[0];
    if (!row) throw new Error('no section');
    return row;
  });
}

/**
 * The row's Attachment row (no file is stored): the actor's own pending one, a fresh Staff
 * member's pending one, or one attached to the row's Thread by a fresh member or by the
 * actor (even one who isn't, or is no longer, in the Channel).
 */
async function attachmentFixture(
  kind: NonNullable<MatrixRow['attachment']>,
  { actor, channel, thread }: Pick<RowContext, 'actor' | 'channel' | 'thread'>,
) {
  switch (kind) {
    case 'ownPending':
      return insertAttachment({ uploaderId: actor.staff.id });
    case 'otherPending':
      return insertAttachment({ uploaderId: (await createStaffMember()).id });
    case 'onThread': {
      if (!channel || !thread) throw new Error('An attached Attachment needs a row with a Thread');
      const uploader = await joinedTarget(channel, false);
      return insertAttachment({
        uploaderId: uploader.id,
        channelId: channel.id,
        threadId: thread.id,
      });
    }
    case 'ownOnThread':
      if (!channel || !thread) throw new Error('An attached Attachment needs a row with a Thread');
      return insertAttachment({
        uploaderId: actor.staff.id,
        channelId: channel.id,
        threadId: thread.id,
      });
  }
}

/** The request's body and headers: JSON, or multipart form data carrying one file. */
function requestInit(request: ReturnType<MatrixRow['request']>, cookie: string): RequestInit {
  if (request.form) {
    const form = new FormData();
    form.set('file', new File([request.form.content], request.form.filename));
    return { headers: formHeaders({ cookie }), body: form };
  }
  return {
    headers: jsonHeaders({ cookie }),
    ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
  };
}

/**
 * Runs one matrix row through the real app. An allow row asserts the status. A deny row
 * asserts the status and that the database is unchanged.
 */
export async function runRow(testApp: TestApp, row: MatrixRow): Promise<void> {
  const actor = await createActor(testApp, row.actor);
  const channel =
    row.channel === null
      ? undefined
      : await channelFixtures(row.channel, { actor }, row.resolvePolicy);
  const target = row.target ? await targetFixtures[row.target]({ actor, channel }) : undefined;
  const thread = row.thread ? await threadFixture({ actor, channel }, row.thread) : undefined;
  const response = row.response ? await responseFixture({ actor, channel, thread }) : undefined;
  const section = row.section ? await sectionFixture(row.section, { actor }) : undefined;
  const attachment = row.attachment
    ? await attachmentFixture(row.attachment, { actor, channel, thread })
    : undefined;
  const request = row.request({ actor, channel, target, thread, response, section, attachment });

  const before = row.expect.allow ? undefined : await databaseSnapshot();
  const res = await testApp.app.request(request.path, {
    method: request.method ?? 'GET',
    ...requestInit(request, actor.cookie),
  });

  expect(res.status, `${row.route} as ${row.actor}: ${row.action}`).toBe(row.expect.status);
  // A stream (GET /api/live) stays open until the client goes: close it.
  await res.body?.cancel();
  if (before) {
    expect(await databaseSnapshot(), `${row.route} as ${row.actor} changed the database`).toEqual(
      before,
    );
  }
}
