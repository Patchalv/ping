// The Channel settings route through the real app: editing a Channel's settings, and
// turning a Public channel Private, with its clean-up and System thread. What it answers
// and changes, beyond the permission matrix's allow and deny statuses. From #42.
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

describe('PATCH /api/channels/:channelId', () => {
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

  const channelPath = (channelId: string) => `/api/channels/${channelId}`;

  /** Who holds each kind of attention row in the Channel, as the owner. */
  const attentionOf = (channelId: string) =>
    asOwner(async (query) => {
      const ids = async (table: string) =>
        (
          await query<{ staff_id: string }>(
            `select staff_id from ${table} where channel_id = $1 order by staff_id`,
            [channelId],
          )
        ).rows.map((r) => r.staff_id);
      return {
        pings: await ids('ping'),
        saved: await ids('saved_thread'),
        mutes: await ids('mute'),
      };
    });

  it('changes the name, description and "Who can resolve threads?", answering the Channel', async () => {
    const channelAdmin = await createStaffMember();
    const channel = await insertChannel({
      members: [{ staffId: channelAdmin.id, channelAdmin: true }],
    });
    const request = await as(channelAdmin);
    const res = await request(channelPath(channel.id), {
      method: 'PATCH',
      body: {
        name: ' Front desk ',
        description: 'Visitors',
        resolvePolicy: 'author_and_channel_admins',
      },
    });
    expect(res.status).toBe(200);
    const view = (await res.json()) as ChannelView;
    expect(view).toMatchObject({
      id: channel.id,
      name: 'Front desk',
      description: 'Visitors',
      resolvePolicy: 'author_and_channel_admins',
      visibility: 'public',
    });
  });

  it('says why a settings change is refused', async () => {
    const member = await createStaffMember();
    const channel = await insertChannel({
      members: [
        { staffId: (await createStaffMember()).id, channelAdmin: true },
        { staffId: member.id },
      ],
    });
    const res = await (await as(member))(channelPath(channel.id), {
      method: 'PATCH',
      body: { name: 'Mine now' },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: 'forbidden', message: 'Only Channel admins change this Channel’s settings.' },
    });
  });

  it('never makes a Private channel Public, even for its Channel admin, and changes nothing', async () => {
    const channelAdmin = await createStaffMember();
    const channel = await insertChannel({
      visibility: 'private',
      members: [{ staffId: channelAdmin.id, channelAdmin: true }],
    });
    const res = await (await as(channelAdmin))(channelPath(channel.id), {
      method: 'PATCH',
      body: { name: 'Renamed', visibility: 'public' },
    });
    expect(res.status).toBe(403);
    const visibility = await asOwner(
      async (query) =>
        (
          await query<{ visibility: string; name: string }>(
            'select visibility, name from channel where id = $1',
            [channel.id],
          )
        ).rows[0],
    );
    expect(visibility).toEqual({ visibility: 'private', name: channel.name });
  });

  describe('turning a Public channel Private', () => {
    async function publicChannelWithAttention() {
      const channelAdmin = await createStaffMember({ name: 'Marta Ruiz' });
      const member = await createStaffMember();
      const muter = await createStaffMember();
      const outsider = await createStaffMember();
      const channel = await insertChannel({
        members: [
          { staffId: channelAdmin.id, channelAdmin: true },
          { staffId: member.id },
          { staffId: muter.id },
        ],
      });
      const thread = await insertThread({ channelId: channel.id, authorId: member.id });
      // The member and the outsider each have a Ping, a Saved Thread and a Thread mute; the
      // muter has muted the whole Channel.
      await asOwner(async (query) => {
        for (const staffId of [member.id, outsider.id]) {
          await query('insert into ping (staff_id, thread_id, channel_id) values ($1, $2, $3)', [
            staffId,
            thread.id,
            channel.id,
          ]);
          await query(
            'insert into saved_thread (staff_id, thread_id, channel_id) values ($1, $2, $3)',
            [staffId, thread.id, channel.id],
          );
          await query('insert into mute (staff_id, channel_id, thread_id) values ($1, $2, $3)', [
            staffId,
            channel.id,
            thread.id,
          ]);
        }
        await query('insert into mute (staff_id, channel_id) values ($1, $2)', [
          muter.id,
          channel.id,
        ]);
      });
      return { channelAdmin, member, muter, outsider, channel, thread };
    }

    it('drops every non-member’s Pings, Saved Threads and mutes, and keeps the members’', async () => {
      const { channelAdmin, member, muter, outsider, channel } = await publicChannelWithAttention();
      const res = await (await as(channelAdmin))(channelPath(channel.id), {
        method: 'PATCH',
        body: { visibility: 'private' },
      });
      expect(res.status).toBe(200);
      expect(((await res.json()) as ChannelView).visibility).toBe('private');

      const after = await attentionOf(channel.id);
      expect(after.saved).toEqual([member.id]);
      expect(after.mutes.sort()).toEqual([member.id, muter.id].sort());
      // The member keeps their Ping and gains one for the System thread; so does the muter.
      expect(after.pings.sort()).toEqual([member.id, member.id, muter.id].sort());
      expect(after.pings).not.toContain(outsider.id);
      expect(after.pings).not.toContain(channelAdmin.id);
    });

    it('starts a System thread from Ping, naming the Channel admin by their current name', async () => {
      const { channelAdmin, member, channel } = await publicChannelWithAttention();
      await (await as(channelAdmin))(channelPath(channel.id), {
        method: 'PATCH',
        body: { visibility: 'private' },
      });
      await asOwner((query) =>
        query(`update "user" set name = 'Marta Ruiz Puig' where id = $1`, [channelAdmin.id]),
      );
      const res = await (await as(member))(`${channelPath(channel.id)}/threads`);
      const page = (await res.json()) as ThreadPage;
      const system = page.threads.find((t) => t.isSystem);
      expect(system).toMatchObject({
        author: null,
        isSystem: true,
        title: 'Marta Ruiz Puig made this Channel Private',
        system: {
          kind: 'channel_made_private',
          staff: { staffId: channelAdmin.id, name: 'Marta Ruiz Puig' },
        },
        pingCount: 1,
      });
    });

    it('shows a company Admin’s edit of the System thread’s title instead of its own', async () => {
      const { channelAdmin, member, channel } = await publicChannelWithAttention();
      const admin = await createStaffMember({ role: 'admin' });
      await asOwner((query) =>
        query('insert into channel_member (channel_id, staff_id) values ($1, $2)', [
          channel.id,
          admin.id,
        ]),
      );
      await (await as(channelAdmin))(channelPath(channel.id), {
        method: 'PATCH',
        body: { visibility: 'private' },
      });
      const threads = async () =>
        (
          (await (
            await (
              await as(member)
            )(`${channelPath(channel.id)}/threads`)
          ).json()) as ThreadPage
        ).threads;
      const system = (await threads()).find((t) => t.isSystem);
      const edit = await (await as(admin))(`${channelPath(channel.id)}/threads/${system?.id}`, {
        method: 'PATCH',
        body: { title: 'Now Private: ask Marta to be added' },
      });
      expect(edit.status).toBe(200);
      expect((await threads()).find((t) => t.isSystem)?.title).toBe(
        'Now Private: ask Marta to be added',
      );
    });

    it('records the change in the audit log', async () => {
      const { channelAdmin, channel } = await publicChannelWithAttention();
      await (await as(channelAdmin))(channelPath(channel.id), {
        method: 'PATCH',
        body: { visibility: 'private' },
      });
      const audit = await asOwner(
        async (query) =>
          (
            await query(
              'select kind, actor_id, target_staff_id from audit_event where channel_id = $1',
              [channel.id],
            )
          ).rows,
      );
      expect(audit).toEqual([
        { kind: 'channel_made_private', actor_id: channelAdmin.id, target_staff_id: null },
      ]);
    });

    it('hides it from a non-member at once', async () => {
      const { channelAdmin, outsider, channel } = await publicChannelWithAttention();
      await (await as(channelAdmin))(channelPath(channel.id), {
        method: 'PATCH',
        body: { visibility: 'private' },
      });
      const res = await (await as(outsider))(channelPath(channel.id));
      expect(res.status).toBe(404);
    });

    it('keeps out a join racing the change: it waits, then finds the Channel Private', async () => {
      const channelAdmin = await createStaffMember();
      const joiner = await createStaffMember();
      const channel = await insertChannel({
        members: [{ staffId: channelAdmin.id, channelAdmin: true }],
      });
      const join = await as(joiner);
      // Turning Private, as the route does it: the membership lock, then the flip, held open.
      const joined = await asOwner(async (query) => {
        await query('begin');
        await query(
          `select pg_advisory_xact_lock(hashtext('ping.channel_membership'), hashtext($1))`,
          [channel.id],
        );
        await query(`update channel set visibility = 'private' where id = $1`, [channel.id]);
        const response = join(`${channelPath(channel.id)}/join`, { method: 'POST' });
        await new Promise((resolve) => setTimeout(resolve, 200));
        await query('commit');
        return response;
      });
      expect(joined.status).toBe(404);
      const rows = await asOwner(
        async (query) =>
          (
            await query('select 1 from channel_member where channel_id = $1 and staff_id = $2', [
              channel.id,
              joiner.id,
            ])
          ).rowCount,
      );
      expect(rows).toBe(0);
    });

    it('changes nothing more when the Channel is already Private', async () => {
      const channelAdmin = await createStaffMember();
      const channel = await insertChannel({
        visibility: 'private',
        members: [{ staffId: channelAdmin.id, channelAdmin: true }],
      });
      const res = await (await as(channelAdmin))(channelPath(channel.id), {
        method: 'PATCH',
        body: { visibility: 'private' },
      });
      expect(res.status).toBe(200);
      const threads = await asOwner(
        async (query) =>
          (await query('select 1 from thread where channel_id = $1', [channel.id])).rowCount,
      );
      expect(threads).toBe(0);
    });
  });
});
