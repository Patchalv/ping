// RLS cases for the archive_channel and unarchive_channel system functions (permissions.md
// › System functions, product.md › Archive): Channel admins, and company Admins on a Public
// channel or a Private one they're in, archive and unarchive a Channel. Archiving starts a
// System thread, which Pings every other active member, mutes ignored. ping_app can't set
// archived_at/by or start a System thread itself, so these are the only way.
//
// The server decides first, but any ping_app connection can call them, so they guard
// themselves on app.staff_id. archive_channel answers the System thread's ID, or null when
// it did nothing; unarchive_channel answers whether it changed anything.
import { describe, expect, it } from 'vitest';
import {
  asOwner,
  asPingApp,
  createStaffMember,
  insertChannel,
  type Query,
} from '../../db/test-support';

const archive = async (query: Query, channelId: string) =>
  (
    await query<{ thread_id: string | null }>('select public.archive_channel($1) as thread_id', [
      channelId,
    ])
  ).rows[0]?.thread_id ?? null;

const unarchive = async (query: Query, channelId: string) =>
  (await query<{ changed: boolean }>('select public.unarchive_channel($1) as changed', [channelId]))
    .rows[0]?.changed;

const archivedOf = async (query: Query, channelId: string) =>
  (
    await query<{ archived_at: Date | null; archived_by: string | null }>(
      'select archived_at, archived_by from channel where id = $1',
      [channelId],
    )
  ).rows[0];

/** Who may archive, and the Channel they act on. */
type Who = 'channelAdmin' | 'adminPublic' | 'adminPrivateMember';

async function channelFor(who: Who, options: { archived?: boolean } = {}) {
  const actor = await createStaffMember({ role: who === 'channelAdmin' ? 'member' : 'admin' });
  const channelAdmin = who === 'channelAdmin' ? actor : await createStaffMember();
  const channel = await insertChannel({
    visibility: who === 'adminPrivateMember' ? 'private' : 'public',
    ...(options.archived ? { archived: true } : {}),
    members: [
      { staffId: channelAdmin.id, channelAdmin: true },
      ...(who === 'adminPrivateMember' ? [{ staffId: actor.id }] : []),
    ],
  });
  return { actor, channel };
}

const ALLOWED = [
  ['its Channel admin', 'channelAdmin'],
  ['a company Admin on a Public channel they aren’t in', 'adminPublic'],
  ['a company Admin on a Private channel they’re in', 'adminPrivateMember'],
] as const;

describe('archive_channel', () => {
  it.each(ALLOWED)('archives for %s and starts its System thread', async (_n, who) => {
    const { actor, channel } = await channelFor(who);
    await asPingApp(actor.id, async (query) => {
      const threadId = await archive(query, channel.id);
      expect(threadId).not.toBeNull();
      const state = await archivedOf(query, channel.id);
      expect(state?.archived_at).toBeInstanceOf(Date);
      expect(state?.archived_by).toBe(actor.id);
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
          system_kind: 'channel_archived',
          system_payload: { staffId: actor.id },
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
      const threadId = await archive(query, channel.id);
      const everyone = [channelAdmin.id, member.id, muter.id, gone.id];
      expect(await pingedAmong(query, threadId, everyone)).toEqual([member.id, muter.id]);
    });
  });

  it('does nothing when app.staff_id is unset', async () => {
    const { channel } = await channelFor('channelAdmin');
    await asPingApp(null, async (query) => {
      expect(await archive(query, channel.id)).toBeNull();
    });
    await asOwner(async (query) =>
      expect((await archivedOf(query, channel.id))?.archived_at).toBeNull(),
    );
  });

  it.each([
    ['a plain member', 'member'],
    ['a non-member', 'none'],
    ['a company Admin outside a Private channel', 'adminOutsidePrivate'],
  ] as const)('can’t be steered by %s', async (_n, who) => {
    const channelAdmin = await createStaffMember();
    const actor = await createStaffMember({
      role: who === 'adminOutsidePrivate' ? 'admin' : 'member',
    });
    const channel = await insertChannel({
      visibility: who === 'adminOutsidePrivate' ? 'private' : 'public',
      members: [
        { staffId: channelAdmin.id, channelAdmin: true },
        ...(who === 'member' ? [{ staffId: actor.id }] : []),
      ],
    });
    await asPingApp(actor.id, async (query) => {
      expect(await archive(query, channel.id)).toBeNull();
    });
    await asOwner(async (query) => {
      expect((await archivedOf(query, channel.id))?.archived_at).toBeNull();
      const threads = await query('select 1 from thread where channel_id = $1', [channel.id]);
      expect(threads.rowCount).toBe(0);
    });
  });

  it('starts no second System thread for a Channel that is already Archived', async () => {
    const { actor, channel } = await channelFor('channelAdmin', { archived: true });
    await asPingApp(actor.id, async (query) => {
      expect(await archive(query, channel.id)).toBeNull();
      const threads = await query('select 1 from thread where channel_id = $1', [channel.id]);
      expect(threads.rowCount).toBe(0);
    });
  });

  it('can’t be called by a Deactivated Channel admin', async () => {
    const { actor, channel } = await channelFor('channelAdmin');
    const other = await createStaffMember({ role: 'admin' });
    await asOwner((query) =>
      query('update staff_member set deactivated_at = now(), deactivated_by = $2 where id = $1', [
        actor.id,
        other.id,
      ]),
    );
    await asPingApp(actor.id, async (query) => {
      expect(await archive(query, channel.id)).toBeNull();
    });
  });

  it('leaves ping_app no way to set archived_at itself', async () => {
    const { actor, channel } = await channelFor('channelAdmin');
    await asPingApp(actor.id, async (query) => {
      await expect(
        query('update channel set archived_at = now(), archived_by = $2 where id = $1', [
          channel.id,
          actor.id,
        ]),
      ).rejects.toThrow(/permission denied/);
    });
  });
});

describe('unarchive_channel', () => {
  it.each(ALLOWED)('clears archived_at/by for %s, starting no System thread', async (_n, who) => {
    const { actor, channel } = await channelFor(who, { archived: true });
    await asPingApp(actor.id, async (query) => {
      expect(await unarchive(query, channel.id)).toBe(true);
      expect(await archivedOf(query, channel.id)).toEqual({ archived_at: null, archived_by: null });
      const threads = await query('select 1 from thread where channel_id = $1', [channel.id]);
      expect(threads.rowCount).toBe(0);
    });
  });

  it('changes nothing on a Channel that isn’t Archived', async () => {
    const { actor, channel } = await channelFor('channelAdmin');
    await asPingApp(actor.id, async (query) => {
      expect(await unarchive(query, channel.id)).toBe(false);
    });
  });

  it('does nothing when app.staff_id is unset', async () => {
    const { channel } = await channelFor('channelAdmin', { archived: true });
    await asPingApp(null, async (query) => {
      expect(await unarchive(query, channel.id)).toBe(false);
    });
    await asOwner(async (query) =>
      expect((await archivedOf(query, channel.id))?.archived_at).toBeInstanceOf(Date),
    );
  });

  it.each([
    ['a plain member', 'member'],
    ['a company Admin outside a Private channel', 'adminOutsidePrivate'],
  ] as const)('can’t be steered by %s', async (_n, who) => {
    const channelAdmin = await createStaffMember();
    const actor = await createStaffMember({
      role: who === 'adminOutsidePrivate' ? 'admin' : 'member',
    });
    const channel = await insertChannel({
      visibility: who === 'adminOutsidePrivate' ? 'private' : 'public',
      archived: true,
      members: [
        { staffId: channelAdmin.id, channelAdmin: true },
        ...(who === 'member' ? [{ staffId: actor.id }] : []),
      ],
    });
    await asPingApp(actor.id, async (query) => {
      expect(await unarchive(query, channel.id)).toBe(false);
    });
    await asOwner(async (query) =>
      expect((await archivedOf(query, channel.id))?.archived_at).toBeInstanceOf(Date),
    );
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
