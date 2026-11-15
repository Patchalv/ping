import { expect } from 'vitest';
import {
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
 * Runs one matrix row through the real app. An allow row asserts the status. A deny row
 * asserts the status and that the database is unchanged.
 */
export async function runRow(testApp: TestApp, row: MatrixRow): Promise<void> {
  const actor = await createActor(testApp, row.actor);
  const channel = row.channel === null ? undefined : await channelFixtures(row.channel, { actor });
  const target = row.target === 'invited' ? await createInvitedStaffMember() : undefined;
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
