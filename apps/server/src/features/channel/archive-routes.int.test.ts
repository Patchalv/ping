// The archive routes through the real app: archiving and unarchiving a Channel, with the
// System thread archiving starts. What they answer and change, beyond the permission
// matrix's allow and deny statuses. From #43.
import type { ChannelView, ThreadPage } from '@ping/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asOwner,
  createStaffMember,
  insertChannel,
  insertThread,
  type StaffFixture,
} from '../../db/test-support';
import { createTestApp, jsonHeaders, signIn, type TestApp } from '../../test/test-app';

describe('PUT and DELETE /api/channels/:channelId/archived', () => {
  let testApp: TestApp;
  beforeAll(() => {
    testApp = createTestApp();
  });
  afterAll(async () => {
    await testApp.close();
  });

  async function as(staff: StaffFixture) {
    const cookie = await signIn(testApp, staff);
    return (path: string, init: { method?: string; body?: unknown } = {}) =>
      testApp.app.request(path, {
        method: init.method ?? 'GET',
        headers: jsonHeaders({ cookie }),
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      });
  }

  const archivedPath = (channelId: string) => `/api/channels/${channelId}/archived`;

  const archivedState = (channelId: string) =>
    asOwner(
      async (query) =>
        (
          await query<{ archived_at: Date | null; archived_by: string | null }>(
            'select archived_at, archived_by from channel where id = $1',
            [channelId],
          )
        ).rows[0],
    );

  const pingsOf = (channelId: string) =>
    asOwner(
      async (query) =>
        (
          await query<{ staff_id: string; thread_id: string }>(
            'select staff_id, thread_id from ping where channel_id = $1 order by staff_id',
            [channelId],
          )
        ).rows,
    );

  async function channelWithMembers() {
    const channelAdmin = await createStaffMember({ name: 'Laura Gómez' });
    const member = await createStaffMember();
    const muter = await createStaffMember();
    const channel = await insertChannel({
      members: [
        { staffId: channelAdmin.id, channelAdmin: true },
        { staffId: member.id },
        { staffId: muter.id },
      ],
    });
    await asOwner((query) =>
      query('insert into mute (staff_id, channel_id) values ($1, $2)', [muter.id, channel.id]),
    );
    return { channelAdmin, member, muter, channel };
  }

  it('archives, setting archived_at/by, and answers the Archived channel', async () => {
    const { channelAdmin, channel } = await channelWithMembers();
    const res = await (await as(channelAdmin))(archivedPath(channel.id), { method: 'PUT' });
    expect(res.status).toBe(200);
    const view = (await res.json()) as ChannelView;
    expect(view).toMatchObject({
      id: channel.id,
      isArchived: true,
      can: { archive: false, unarchive: true },
    });
    const state = await archivedState(channel.id);
    expect(state?.archived_at).toBeInstanceOf(Date);
    expect(state?.archived_by).toBe(channelAdmin.id);
  });

  it('starts a System thread naming who archived it, and Pings only its other members for it', async () => {
    const { channelAdmin, member, muter, channel } = await channelWithMembers();
    await (await as(channelAdmin))(archivedPath(channel.id), { method: 'PUT' });

    const page = (await (
      await (await as(member))(`/api/channels/${channel.id}/threads`)
    ).json()) as ThreadPage;
    const system = page.threads.find((t) => t.isSystem);
    expect(system).toMatchObject({
      author: null,
      title: 'Laura Gómez archived this Channel',
      system: { kind: 'channel_archived', staff: { staffId: channelAdmin.id, name: 'Laura Gómez' } },
      pingCount: 1,
      canReact: false,
    });
    expect((await pingsOf(channel.id)).map((p) => p.staff_id).sort()).toEqual(
      [member.id, muter.id].sort(),
    );
  });

  it('keeps open Pings until they’re Acknowledged', async () => {
    const { channelAdmin, member, channel } = await channelWithMembers();
    const thread = await insertThread({ channelId: channel.id, authorId: channelAdmin.id });
    await asOwner((query) =>
      query('insert into ping (staff_id, thread_id, channel_id) values ($1, $2, $3)', [
        member.id,
        thread.id,
        channel.id,
      ]),
    );
    await (await as(channelAdmin))(archivedPath(channel.id), { method: 'PUT' });
    const memberPings = (await pingsOf(channel.id)).filter((p) => p.staff_id === member.id);
    expect(memberPings.map((p) => p.thread_id)).toContain(thread.id);

    const ack = await (await as(member))(`/api/channels/${channel.id}/threads/${thread.id}/ping`, {
      method: 'DELETE',
    });
    expect(ack.status).toBe(204);
  });

  it('says why archiving an Archived channel is refused, and starts no second System thread', async () => {
    const { channelAdmin, channel } = await channelWithMembers();
    const request = await as(channelAdmin);
    await request(archivedPath(channel.id), { method: 'PUT' });
    const again = await request(archivedPath(channel.id), { method: 'PUT' });
    expect(again.status).toBe(403);
    expect(await again.json()).toEqual({
      error: { code: 'forbidden', message: 'This Channel is already archived.' },
    });
    const systemThreads = await asOwner(
      async (query) =>
        (await query('select 1 from thread where channel_id = $1 and is_system', [channel.id]))
          .rowCount,
    );
    expect(systemThreads).toBe(1);
  });

  it('starts one System thread when two Channel admins archive at once', async () => {
    const first = await createStaffMember();
    const second = await createStaffMember();
    const channel = await insertChannel({
      members: [
        { staffId: first.id, channelAdmin: true },
        { staffId: second.id, channelAdmin: true },
      ],
    });
    const [a, b] = await Promise.all([as(first), as(second)]);
    const results = await Promise.all([
      a(archivedPath(channel.id), { method: 'PUT' }),
      b(archivedPath(channel.id), { method: 'PUT' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 403]);
    const systemThreads = await asOwner(
      async (query) =>
        (await query('select 1 from thread where channel_id = $1 and is_system', [channel.id]))
          .rowCount,
    );
    expect(systemThreads).toBe(1);
  });

  it('unarchives, clearing archived_at/by, with no System thread or Pings', async () => {
    const channelAdmin = await createStaffMember();
    const member = await createStaffMember();
    const channel = await insertChannel({
      archived: true,
      members: [{ staffId: channelAdmin.id, channelAdmin: true }, { staffId: member.id }],
    });
    const res = await (await as(channelAdmin))(archivedPath(channel.id), { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as ChannelView).isArchived).toBe(false);
    expect(await archivedState(channel.id)).toEqual({ archived_at: null, archived_by: null });
    const threads = await asOwner(
      async (query) =>
        (await query('select 1 from thread where channel_id = $1', [channel.id])).rowCount,
    );
    expect(threads).toBe(0);
    expect(await pingsOf(channel.id)).toEqual([]);
  });

  it('lets a company Admin archive a Public channel they aren’t in', async () => {
    const { channel } = await channelWithMembers();
    const admin = await createStaffMember({ role: 'admin' });
    const res = await (await as(admin))(archivedPath(channel.id), { method: 'PUT' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as ChannelView).can).toEqual({ archive: false, unarchive: true });
  });

  it('says why a plain member can’t archive', async () => {
    const { member, channel } = await channelWithMembers();
    const res = await (await as(member))(archivedPath(channel.id), { method: 'PUT' });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: {
        code: 'forbidden',
        message: 'Only Channel admins and company Admins can archive or unarchive this Channel.',
      },
    });
    expect((await archivedState(channel.id))?.archived_at).toBeNull();
  });

  it('blocks new Threads once archived, and allows them again once unarchived', async () => {
    const { channelAdmin, member, channel } = await channelWithMembers();
    const admin = await as(channelAdmin);
    const post = async () =>
      (await as(member))(`/api/channels/${channel.id}/threads`, {
        method: 'POST',
        body: {
          title: 'Heater broken in room 2',
          body: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Cold' }] }] },
        },
      });
    await admin(archivedPath(channel.id), { method: 'PUT' });
    expect((await post()).status).toBe(403);
    await admin(archivedPath(channel.id), { method: 'DELETE' });
    expect((await post()).status).toBe(201);
  });
});
