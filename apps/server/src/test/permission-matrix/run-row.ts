import { expect } from 'vitest';
import {
  asOwner,
  createInvitedStaffMember,
  createStaffMember,
  databaseSnapshot,
  insertChannel,
} from '../../db/test-support';
import { jsonHeaders, type TestApp } from '../test-app';
import { CHANNEL_ROLE, createActor } from './actors';
import type { ChannelKind, MatrixRow, RowContext } from './matrix';

/**
 * Creates the row's Channel and the actor's relationship to it (author, Channel admin,
 * member, or none).
 */
type ChannelFixtures = (
  kind: ChannelKind,
  ctx: Pick<RowContext, 'actor'>,
) => Promise<{ id: string }>;

/**
 * The standard Channel fixtures. Every Channel has a Channel admin: the actor, when they
 * are the Channel admin, or else a fresh Staff member. An Archived channel is Public.
 */
const channelFixtures: ChannelFixtures = async (kind, { actor }) => {
  const role = CHANNEL_ROLE[actor.kind];
  const members =
    role === 'channelAdmin'
      ? [{ staffId: actor.staff.id, channelAdmin: true }]
      : [
          { staffId: (await createStaffMember()).id, channelAdmin: true },
          ...(role === 'member' ? [{ staffId: actor.staff.id }] : []),
        ];
  return insertChannel({
    visibility: kind === 'private' ? 'private' : 'public',
    archived: kind === 'archived',
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
 * Runs one matrix row through the real app. An allow row asserts the status. A deny row
 * asserts the status and that the database is unchanged.
 */
export async function runRow(testApp: TestApp, row: MatrixRow): Promise<void> {
  const actor = await createActor(testApp, row.actor);
  const channel = row.channel === null ? undefined : await channelFixtures(row.channel, { actor });
  const target = row.target ? await targetFixtures[row.target]({ actor, channel }) : undefined;
  const request = row.request({ actor, channel, target });

  const before = row.expect.allow ? undefined : await databaseSnapshot();
  const res = await testApp.app.request(request.path, {
    method: request.method ?? 'GET',
    headers: jsonHeaders({ cookie: actor.cookie }),
    ...(request.body === undefined ? {} : { body: JSON.stringify(request.body) }),
  });

  expect(res.status, `${row.route} as ${row.actor}: ${row.action}`).toBe(row.expect.status);
  if (before) {
    expect(await databaseSnapshot(), `${row.route} as ${row.actor} changed the database`).toEqual(
      before,
    );
  }
}
