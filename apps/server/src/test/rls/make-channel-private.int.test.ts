// RLS cases for the make_channel_private system function (permissions.md › System
// functions, product.md › System threads): a Channel admin turns a Public channel Private,
// and Ping starts its System thread, which Pings every other active member, mutes ignored.
// ping_app can't update a Channel's visibility or start a System thread itself, so this is
// the only way, and nothing can make a Private channel Public.
//
// The server decides first, but any ping_app connection can call the function, so it
// guards itself: an active Channel admin of that Channel in app.staff_id, and a Public
// channel that isn't Archived. It answers the System thread's ID, or null when it did
// nothing.
import { describe, expect, it } from 'vitest';
import {
  asOwner,
  asPingApp,
  createStaffMember,
  insertChannel,
  type Query,
} from '../../db/test-support';

const makePrivate = async (query: Query, channelId: string) =>
  (
    await query<{ thread_id: string | null }>(
      'select public.make_channel_private($1) as thread_id',
      [channelId],
    )
  ).rows[0]?.thread_id ?? null;

const visibilityOf = async (query: Query, channelId: string) =>
  (await query<{ visibility: string }>('select visibility from channel where id = $1', [channelId]))
    .rows[0]?.visibility;

describe('make_channel_private', () => {
  it('turns a Public channel Private and starts its System thread, naming the actor by ID', async () => {
    const channelAdmin = await createStaffMember();
    const channel = await insertChannel({
      members: [{ staffId: channelAdmin.id, channelAdmin: true }],
    });
    await asPingApp(channelAdmin.id, async (query) => {
      const threadId = await makePrivate(query, channel.id);
      expect(threadId).not.toBeNull();
      expect(await visibilityOf(query, channel.id)).toBe('private');
      const thread = await query(
        `select channel_id, author_id, is_system, system_kind, system_payload
           from thread where id = $1`,
        [threadId],
      );
      expect(thread.rows).toEqual([
        {
          channel_id: channel.id,
          author_id: null,
          is_system: true,
          system_kind: 'channel_made_private',
          system_payload: { staffId: channelAdmin.id },
        },
      ]);
    });
  });

  it('Pings every other active member, mutes ignored, but not the actor or anyone Deactivated', async () => {
    const channelAdmin = await createStaffMember();
    const member = await createStaffMember();
    const muter = await createStaffMember();
    const gone = await createStaffMember();
    const channel = await insertChannel({
      members: [
        { staffId: channelAdmin.id, channelAdmin: true },
        { staffId: member.id },
        { staffId: muter.id },
        { staffId: gone.id },
      ],
    });
    await asOwner(async (query) => {
      await query('insert into mute (staff_id, channel_id) values ($1, $2)', [
        muter.id,
        channel.id,
      ]);
      await query(
        'update staff_member set deactivated_at = now(), deactivated_by = $2 where id = $1',
        [gone.id, channelAdmin.id],
      );
    });
    await asPingApp(channelAdmin.id, async (query) => {
      const threadId = await makePrivate(query, channel.id);
      const everyone = [channelAdmin.id, member.id, muter.id, gone.id];
      expect(await pingedAmong(query, threadId, everyone)).toEqual([member.id, muter.id]);
    });
  });

  it('does nothing when app.staff_id is unset', async () => {
    const channelAdmin = await createStaffMember();
    const channel = await insertChannel({
      members: [{ staffId: channelAdmin.id, channelAdmin: true }],
    });
    await asPingApp(null, async (query) => {
      expect(await makePrivate(query, channel.id)).toBeNull();
    });
    await asOwner(async (query) => expect(await visibilityOf(query, channel.id)).toBe('public'));
  });

  it.each([
    ['a plain member', 'member'],
    ['a non-member', 'none'],
    ['a company Admin who isn’t Channel admin', 'admin'],
  ] as const)('can’t be steered by %s at a Channel they don’t administer', async (_n, who) => {
    const channelAdmin = await createStaffMember();
    const actor = await createStaffMember({ role: who === 'admin' ? 'admin' : 'member' });
    const channel = await insertChannel({
      members: [
        { staffId: channelAdmin.id, channelAdmin: true },
        ...(who === 'member' ? [{ staffId: actor.id }] : []),
      ],
    });
    await asPingApp(actor.id, async (query) => {
      expect(await makePrivate(query, channel.id)).toBeNull();
      expect(await visibilityOf(query, channel.id)).toBe('public');
    });
  });

  it('leaves an Archived channel alone', async () => {
    const channelAdmin = await createStaffMember();
    const channel = await insertChannel({
      archived: true,
      members: [{ staffId: channelAdmin.id, channelAdmin: true }],
    });
    await asPingApp(channelAdmin.id, async (query) => {
      expect(await makePrivate(query, channel.id)).toBeNull();
      expect(await visibilityOf(query, channel.id)).toBe('public');
    });
  });

  it('starts no second System thread for a Channel that is already Private', async () => {
    const channelAdmin = await createStaffMember();
    const channel = await insertChannel({
      visibility: 'private',
      members: [{ staffId: channelAdmin.id, channelAdmin: true }],
    });
    await asPingApp(channelAdmin.id, async (query) => {
      expect(await makePrivate(query, channel.id)).toBeNull();
      const threads = await query('select 1 from thread where channel_id = $1', [channel.id]);
      expect(threads.rowCount).toBe(0);
    });
  });

  it('can’t be called by a Deactivated Channel admin', async () => {
    const channelAdmin = await createStaffMember();
    const other = await createStaffMember({ role: 'admin' });
    const channel = await insertChannel({
      members: [{ staffId: channelAdmin.id, channelAdmin: true }],
    });
    await asOwner((query) =>
      query('update staff_member set deactivated_at = now(), deactivated_by = $2 where id = $1', [
        channelAdmin.id,
        other.id,
      ]),
    );
    await asPingApp(channelAdmin.id, async (query) => {
      expect(await makePrivate(query, channel.id)).toBeNull();
    });
  });
});

/**
 * Which of `staff` have a Ping on the Thread. ping_app reads only its own Pings, so the
 * case's transaction acts as each in turn.
 */
async function pingedAmong(query: Query, threadId: string | null, staff: string[]) {
  const pinged: string[] = [];
  for (const staffId of staff) {
    await query(`select set_config('app.staff_id', $1, true)`, [staffId]);
    const result = await query('select 1 from ping where thread_id = $1', [threadId]);
    if (result.rowCount) pinged.push(staffId);
  }
  return pinged;
}
