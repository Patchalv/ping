// The Channel member routes through the real app: the Members tab, adding and removing
// members, and appointing Channel admins. What they answer, beyond the permission matrix's
// allow and deny statuses. From "Channel members and Channel admins" (#37).
import type { ChannelMembers, MemberCandidate } from '@ping/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asOwner,
  createInvitedStaffMember,
  createStaffMember,
  insertChannel,
  type StaffFixture,
} from '../../db/test-support';
import { createTestApp, jsonHeaders, signIn, type TestApp } from '../../test/test-app';

describe('Channel member routes', () => {
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

  /** The Channel's rows, as the owner: staff ID → is_channel_admin. */
  const rowsOf = (channelId: string) =>
    asOwner(async (query) => {
      const { rows } = await query<{ staff_id: string; is_channel_admin: boolean }>(
        'select staff_id, is_channel_admin from channel_member where channel_id = $1',
        [channelId],
      );
      return Object.fromEntries(rows.map((r) => [r.staff_id, r.is_channel_admin]));
    });

  /** The Channel's audit events, oldest first. */
  const auditOf = (channelId: string) =>
    asOwner(async (query) => {
      const { rows } = await query<{ kind: string; actor_id: string; target_staff_id: string }>(
        `select kind, actor_id, target_staff_id from audit_event
          where channel_id = $1 order by created_at, kind`,
        [channelId],
      );
      return rows;
    });

  const members = (channelId: string) => `/api/channels/${channelId}/members`;
  const member = (channelId: string, staffId: string) =>
    `/api/channels/${channelId}/members/${staffId}`;

  describe('GET /api/channels/:channelId/members', () => {
    it('lists Channel admins first, then members, by name, with Deactivated members flagged', async () => {
      const ana = await createStaffMember({ name: 'Ana Channel admin' });
      const zoe = await createStaffMember({ name: 'Zoe Channel admin' });
      const bea = await createStaffMember({ name: 'Bea member' });
      const gone = await createStaffMember({ name: 'Carlos gone', deactivated: true });
      const channel = await insertChannel({
        members: [
          { staffId: zoe.id, channelAdmin: true },
          { staffId: ana.id, channelAdmin: true },
          { staffId: gone.id },
          { staffId: bea.id },
        ],
      });
      const request = await as(bea);
      const res = await request(members(channel.id));
      expect(res.status).toBe(200);
      expect((await res.json()) as ChannelMembers).toEqual({
        members: [
          { staffId: ana.id, name: ana.name, isChannelAdmin: true, isDeactivated: false },
          { staffId: zoe.id, name: zoe.name, isChannelAdmin: true, isDeactivated: false },
          { staffId: bea.id, name: bea.name, isChannelAdmin: false, isDeactivated: false },
          { staffId: gone.id, name: gone.name, isChannelAdmin: false, isDeactivated: true },
        ],
        actorStaffId: bea.id,
        can: { add: true, remove: false, setChannelAdmin: false },
      });
    });

    it('gives a company Admin who is not in a Public channel only the Channel admin control', async () => {
      const admin = await createStaffMember({ role: 'admin' });
      const channel = await insertChannel();
      const request = await as(admin);
      const res = await request(members(channel.id));
      expect(((await res.json()) as ChannelMembers).can).toEqual({
        add: false,
        remove: false,
        setChannelAdmin: true,
      });
    });

    it('answers a Private channel to a non-member company Admin exactly as a missing one', async () => {
      const admin = await createStaffMember({ role: 'admin' });
      const channel = await insertChannel({ visibility: 'private' });
      const request = await as(admin);
      const res = await request(members(channel.id));
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/channels/:channelId/member-candidates', () => {
    it('offers only active Staff members who are not in the Channel', async () => {
      const channelAdmin = await createStaffMember();
      const already = await createStaffMember();
      const active = await createStaffMember();
      const invited = await createInvitedStaffMember();
      const deactivated = await createStaffMember({ deactivated: true });
      const channel = await insertChannel({
        visibility: 'private',
        members: [{ staffId: channelAdmin.id, channelAdmin: true }, { staffId: already.id }],
      });
      const request = await as(channelAdmin);
      const res = await request(`/api/channels/${channel.id}/member-candidates`);
      expect(res.status).toBe(200);
      const ids = ((await res.json()) as MemberCandidate[]).map((c) => c.staffId);
      expect(ids).toContain(active.id);
      for (const left of [channelAdmin, already, invited, deactivated]) {
        expect(ids).not.toContain(left.id);
      }
    });
  });

  describe('POST /api/channels/:channelId/members', () => {
    it('lets a plain member add someone to a Public channel, as a plain member, and records it', async () => {
      const adder = await createStaffMember();
      const added = await createStaffMember();
      const channelAdmin = await createStaffMember();
      const channel = await insertChannel({
        members: [{ staffId: channelAdmin.id, channelAdmin: true }, { staffId: adder.id }],
      });
      const request = await as(adder);
      const res = await request(members(channel.id), {
        method: 'POST',
        body: { staffId: added.id },
      });
      expect(res.status).toBe(204);
      expect(await rowsOf(channel.id)).toMatchObject({ [added.id]: false });
      expect(await auditOf(channel.id)).toEqual([
        { kind: 'channel_member_added', actor_id: adder.id, target_staff_id: added.id },
      ]);
    });

    it('changes nothing, and records nothing, for someone already in the Channel', async () => {
      const channelAdmin = await createStaffMember();
      const already = await createStaffMember();
      const channel = await insertChannel({
        members: [{ staffId: channelAdmin.id, channelAdmin: true }, { staffId: already.id }],
      });
      const request = await as(channelAdmin);
      const res = await request(members(channel.id), {
        method: 'POST',
        body: { staffId: channelAdmin.id },
      });
      expect(res.status).toBe(204);
      expect(await rowsOf(channel.id)).toEqual({ [channelAdmin.id]: true, [already.id]: false });
      expect(await auditOf(channel.id)).toEqual([]);
    });

    it('refuses an Invited person with a message the UI can show', async () => {
      const channelAdmin = await createStaffMember();
      const invited = await createInvitedStaffMember();
      const channel = await insertChannel({
        members: [{ staffId: channelAdmin.id, channelAdmin: true }],
      });
      const request = await as(channelAdmin);
      const res = await request(members(channel.id), {
        method: 'POST',
        body: { staffId: invited.id },
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: {
          code: 'forbidden',
          message: 'Only active Staff members can be added. Invited and Deactivated people can’t.',
        },
      });
    });

    it('gives someone added to a Private channel access at once', async () => {
      const channelAdmin = await createStaffMember();
      const added = await createStaffMember();
      const channel = await insertChannel({
        visibility: 'private',
        members: [{ staffId: channelAdmin.id, channelAdmin: true }],
      });
      const asAdded = await as(added);
      expect((await asAdded(`/api/channels/${channel.id}`)).status).toBe(404);
      const request = await as(channelAdmin);
      await request(members(channel.id), { method: 'POST', body: { staffId: added.id } });
      expect((await asAdded(`/api/channels/${channel.id}`)).status).toBe(200);
    });
  });

  describe('DELETE /api/channels/:channelId/members/:staffId', () => {
    it('takes a Private channel away from the removed member at once, and records it', async () => {
      const channelAdmin = await createStaffMember();
      const removed = await createStaffMember();
      const channel = await insertChannel({
        visibility: 'private',
        members: [{ staffId: channelAdmin.id, channelAdmin: true }, { staffId: removed.id }],
      });
      const asRemoved = await as(removed);
      expect((await asRemoved(`/api/channels/${channel.id}`)).status).toBe(200);

      const request = await as(channelAdmin);
      const res = await request(member(channel.id, removed.id), { method: 'DELETE' });
      expect(res.status).toBe(204);
      expect((await asRemoved(`/api/channels/${channel.id}`)).status).toBe(404);
      expect(await auditOf(channel.id)).toEqual([
        { kind: 'channel_member_removed', actor_id: channelAdmin.id, target_staff_id: removed.id },
      ]);
    });

    it('sends a Channel admin removing themself to Leave', async () => {
      const channelAdmin = await createStaffMember();
      const other = await createStaffMember();
      const channel = await insertChannel({
        members: [
          { staffId: channelAdmin.id, channelAdmin: true },
          { staffId: other.id, channelAdmin: true },
        ],
      });
      const request = await as(channelAdmin);
      const res = await request(member(channel.id, channelAdmin.id), { method: 'DELETE' });
      expect(res.status).toBe(403);
      expect(await rowsOf(channel.id)).toMatchObject({ [channelAdmin.id]: true });
    });

    it('never leaves a Channel without a Channel admin when its two Channel admins remove each other at once', async () => {
      const a = await createStaffMember();
      const b = await createStaffMember();
      const channel = await insertChannel({
        members: [
          { staffId: a.id, channelAdmin: true },
          { staffId: b.id, channelAdmin: true },
        ],
      });
      const [asA, asB] = await Promise.all([as(a), as(b)]);
      const responses = await Promise.all([
        asA(member(channel.id, b.id), { method: 'DELETE' }),
        asB(member(channel.id, a.id), { method: 'DELETE' }),
      ]);
      expect(responses.map((r) => r.status).sort()).toEqual([204, 403]);
      expect(Object.values(await rowsOf(channel.id))).toEqual([true]);
    });
  });

  describe('PATCH /api/channels/:channelId/members/:staffId', () => {
    it('lets a Channel admin appoint a member and remove the role again, recording both', async () => {
      const channelAdmin = await createStaffMember();
      const target = await createStaffMember();
      const channel = await insertChannel({
        visibility: 'private',
        members: [{ staffId: channelAdmin.id, channelAdmin: true }, { staffId: target.id }],
      });
      const request = await as(channelAdmin);
      const appoint = await request(member(channel.id, target.id), {
        method: 'PATCH',
        body: { isChannelAdmin: true },
      });
      expect(appoint.status).toBe(204);
      expect(await rowsOf(channel.id)).toMatchObject({ [target.id]: true });
      const demote = await request(member(channel.id, target.id), {
        method: 'PATCH',
        body: { isChannelAdmin: false },
      });
      expect(demote.status).toBe(204);
      expect(await rowsOf(channel.id)).toMatchObject({ [target.id]: false });
      expect((await auditOf(channel.id)).map((e) => e.kind).sort()).toEqual([
        'channel_admin_appointed',
        'channel_admin_removed',
      ]);
    });

    it('stops the last active Channel admin removing their own role, counting a Deactivated one as gone', async () => {
      const channelAdmin = await createStaffMember();
      const gone = await createStaffMember({ deactivated: true });
      const channel = await insertChannel({
        members: [
          { staffId: channelAdmin.id, channelAdmin: true },
          { staffId: gone.id, channelAdmin: true },
        ],
      });
      const request = await as(channelAdmin);
      const res = await request(member(channel.id, channelAdmin.id), {
        method: 'PATCH',
        body: { isChannelAdmin: false },
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({
        error: {
          message:
            'A Channel needs an active Channel admin. Make someone else Channel admin first.',
        },
      });
    });

    it('lets a company Admin who is not a member make themself Channel admin of a Public channel', async () => {
      const admin = await createStaffMember({ role: 'admin' });
      const channel = await insertChannel();
      const request = await as(admin);
      const res = await request(member(channel.id, admin.id), {
        method: 'PATCH',
        body: { isChannelAdmin: true },
      });
      expect(res.status).toBe(204);
      const listed = (await (await request(members(channel.id))).json()) as ChannelMembers;
      expect(listed.members).toContainEqual({
        staffId: admin.id,
        name: admin.name,
        isChannelAdmin: true,
        isDeactivated: false,
      });
      expect(listed.can).toEqual({ add: true, remove: true, setChannelAdmin: true });
      expect(await auditOf(channel.id)).toEqual([
        { kind: 'channel_admin_appointed', actor_id: admin.id, target_staff_id: admin.id },
      ]);
    });

    it('lets a company Admin appoint someone who is not a member, and remove the role', async () => {
      const admin = await createStaffMember({ role: 'admin' });
      const target = await createStaffMember();
      const channel = await insertChannel({
        members: [{ staffId: (await createStaffMember()).id, channelAdmin: true }],
      });
      const request = await as(admin);
      const appoint = await request(member(channel.id, target.id), {
        method: 'PATCH',
        body: { isChannelAdmin: true },
      });
      expect(appoint.status).toBe(204);
      expect(await rowsOf(channel.id)).toMatchObject({ [target.id]: true });
      const demote = await request(member(channel.id, target.id), {
        method: 'PATCH',
        body: { isChannelAdmin: false },
      });
      expect(demote.status).toBe(204);
      expect(await rowsOf(channel.id)).toMatchObject({ [target.id]: false });
    });

    it('refuses a Channel admin appointing someone who is not in the Channel', async () => {
      const channelAdmin = await createStaffMember();
      const outsider = await createStaffMember();
      const channel = await insertChannel({
        members: [{ staffId: channelAdmin.id, channelAdmin: true }],
      });
      const request = await as(channelAdmin);
      const res = await request(member(channel.id, outsider.id), {
        method: 'PATCH',
        body: { isChannelAdmin: true },
      });
      expect(res.status).toBe(403);
    });

    it('never leaves a Channel without a Channel admin when its two Channel admins demote each other at once', async () => {
      const a = await createStaffMember();
      const b = await createStaffMember();
      const channel = await insertChannel({
        members: [
          { staffId: a.id, channelAdmin: true },
          { staffId: b.id, channelAdmin: true },
        ],
      });
      const [asA, asB] = await Promise.all([as(a), as(b)]);
      const body = { isChannelAdmin: false };
      const responses = await Promise.all([
        asA(member(channel.id, b.id), { method: 'PATCH', body }),
        asB(member(channel.id, a.id), { method: 'PATCH', body }),
      ]);
      expect(responses.map((r) => r.status).sort()).toEqual([204, 403]);
      expect(Object.values(await rowsOf(channel.id)).filter(Boolean)).toEqual([true]);
    });
  });
});
