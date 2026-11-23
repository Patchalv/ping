// The Channel routes through the real app: what they answer, beyond the permission
// matrix's allow and deny statuses.
import { randomUUID } from 'node:crypto';
import type { BrowseChannel, ChannelView, SidebarChannel } from '@ping/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asOwner,
  createStaffMember,
  insertChannel,
  type StaffFixture,
} from '../../db/test-support';
import { createTestApp, jsonHeaders, signIn, type TestApp } from '../../test/test-app';

describe('Channel routes', () => {
  let testApp: TestApp;
  beforeAll(() => {
    testApp = createTestApp();
  });
  afterAll(async () => {
    await testApp.close();
  });

  async function as(staff: StaffFixture) {
    const cookie = await signIn(testApp, staff);
    return (path: string, init: { method?: string; body?: string } = {}) =>
      testApp.app.request(path, { ...init, headers: jsonHeaders({ cookie }) });
  }

  describe('POST /api/channels', () => {
    it('creates a Private channel with its creator as the only member and its Channel admin', async () => {
      const request = await as(await createStaffMember());
      const res = await request('/api/channels', {
        method: 'POST',
        body: JSON.stringify({
          name: ' Owners ',
          description: 'Owners only',
          visibility: 'private',
        }),
      });
      expect(res.status).toBe(201);
      const channel = (await res.json()) as ChannelView;
      expect(channel).toEqual({
        id: expect.any(String),
        name: 'Owners',
        description: 'Owners only',
        visibility: 'private',
        memberCount: 1,
        isMember: true,
        isChannelAdmin: true,
        isArchived: false,
        isMuted: false,
      });

      const read = await request(`/api/channels/${channel.id}`);
      expect(read.status).toBe(200);
      expect(await read.json()).toEqual(channel);
    });

    it('refuses a missing name with a validation error the UI can show', async () => {
      const request = await as(await createStaffMember());
      const res = await request('/api/channels', {
        method: 'POST',
        body: JSON.stringify({ name: '  ', description: 'x'.repeat(501), visibility: 'public' }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: {
          code: 'validation',
          message: 'Give the Channel a name.',
          issues: [
            { path: 'name', message: 'Give the Channel a name.' },
            { path: 'description', message: 'Keep the description to 500 characters or fewer.' },
          ],
        },
      });
    });

    it('refuses a body that is not JSON with a 400, not a 500', async () => {
      const request = await as(await createStaffMember());
      const res = await request('/api/channels', { method: 'POST', body: '{not json' });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: { code: 'validation' } });
    });

    it('answers 401 to a session that outlived a Deactivation', async () => {
      // Deactivating deletes sessions; this proves the role read in withActorTx holds even
      // if one survived.
      const member = await createStaffMember();
      const request = await as(member);
      const admin = await createStaffMember({ role: 'admin' });
      await asOwner((query) =>
        query('update staff_member set deactivated_at = now(), deactivated_by = $2 where id = $1', [
          member.id,
          admin.id,
        ]),
      );
      const res = await request('/api/channels', {
        method: 'POST',
        body: JSON.stringify({ name: 'Ops', visibility: 'public' }),
      });
      expect(res.status).toBe(401);
      expect((await request('/api/channels')).status).toBe(401);
    });

    it('answers 401 with no session', async () => {
      const res = await testApp.app.request('/api/channels', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ name: 'Ops', visibility: 'public' }),
      });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/channels', () => {
    it('lists only the Channels the Staff member is a member of, by name, Private ones included', async () => {
      const member = await createStaffMember();
      const zebra = await insertChannel({ name: 'Zebra', members: [{ staffId: member.id }] });
      const alpha = await insertChannel({
        name: 'Alpha',
        visibility: 'private',
        members: [{ staffId: member.id, channelAdmin: true }],
      });
      await insertChannel({ name: 'Not joined', visibility: 'public' });
      const request = await as(member);

      const res = await request('/api/channels');
      expect(res.status).toBe(200);
      expect((await res.json()) as SidebarChannel[]).toEqual([
        { id: alpha.id, name: 'Alpha', visibility: 'private', isMuted: false },
        { id: zebra.id, name: 'Zebra', visibility: 'public', isMuted: false },
      ]);
    });
  });

  describe('GET /api/channels/:channelId', () => {
    it('shows a Public channel to a non-member, counting only active members', async () => {
      const a = await createStaffMember();
      const b = await createStaffMember();
      const gone = await createStaffMember({ deactivated: true });
      const channel = await insertChannel({
        members: [{ staffId: a.id, channelAdmin: true }, { staffId: b.id }, { staffId: gone.id }],
      });
      const request = await as(await createStaffMember());
      const res = await request(`/api/channels/${channel.id}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        id: channel.id,
        memberCount: 2,
        isMember: false,
        isChannelAdmin: false,
      });
    });

    it('answers a Private channel to a non-member company Admin exactly as a missing one', async () => {
      const channel = await insertChannel({ visibility: 'private' });
      const request = await as(await createStaffMember({ role: 'admin' }));
      const hidden = await request(`/api/channels/${channel.id}`);
      const missing = await request(`/api/channels/${randomUUID()}`);
      expect(hidden.status).toBe(404);
      expect(missing.status).toBe(404);
      expect(await hidden.json()).toEqual(await missing.json());
    });

    it('refuses a Channel ID that is not a UUID with a 400', async () => {
      const request = await as(await createStaffMember());
      expect((await request('/api/channels/front-desk')).status).toBe(400);
    });
  });

  const joinedAt = async (channelId: string, staffId: string) =>
    asOwner(async (query) => {
      const { rows } = await query<{ joined_at: Date }>(
        'select joined_at from channel_member where channel_id = $1 and staff_id = $2',
        [channelId, staffId],
      );
      return rows[0]?.joined_at;
    });

  const post = { method: 'POST' };

  /** The Channel's audit events, as the owner. */
  const auditOf = (channelId: string) =>
    asOwner(async (query) => {
      const { rows } = await query<{ kind: string; actor_id: string; target_staff_id: string }>(
        'select kind, actor_id, target_staff_id from audit_event where channel_id = $1',
        [channelId],
      );
      return rows;
    });

  describe('GET /api/channels/browse', () => {
    it('lists every Public channel by name, with member counts and whether the actor is in it', async () => {
      const member = await createStaffMember();
      const other = await createStaffMember();
      const gone = await createStaffMember({ deactivated: true });
      // A unique prefix keeps other tests' Channels out of the comparison.
      const tag = randomUUID().slice(0, 8);
      const joined = await insertChannel({
        name: `${tag} Bravo`,
        members: [{ staffId: other.id, channelAdmin: true }, { staffId: member.id }],
      });
      const open = await insertChannel({
        name: `${tag} Alpha`,
        members: [{ staffId: other.id, channelAdmin: true }, { staffId: gone.id }],
      });
      await insertChannel({
        name: `${tag} Mine but Private`,
        visibility: 'private',
        members: [{ staffId: member.id, channelAdmin: true }],
      });
      await insertChannel({ name: `${tag} Archived`, archived: true });
      const request = await as(member);

      const res = await request('/api/channels/browse');
      expect(res.status).toBe(200);
      const listed = ((await res.json()) as BrowseChannel[]).filter((c) => c.name.startsWith(tag));
      expect(listed).toEqual([
        { id: open.id, name: `${tag} Alpha`, description: '', memberCount: 1, isMember: false },
        { id: joined.id, name: `${tag} Bravo`, description: '', memberCount: 2, isMember: true },
      ]);
    });
  });

  describe('POST /api/channels/:channelId/join', () => {
    it('makes the actor a plain member, with a new joined_at, and puts the Channel in their sidebar', async () => {
      const member = await createStaffMember();
      const channel = await insertChannel();
      const request = await as(member);

      const before = Date.now();
      const res = await request(`/api/channels/${channel.id}/join`, post);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        id: channel.id,
        isMember: true,
        isChannelAdmin: false,
        memberCount: 1,
      });
      // Allow for clock skew between the test and the database.
      expect((await joinedAt(channel.id, member.id))?.getTime()).toBeGreaterThan(before - 5000);
      const sidebar = (await (await request('/api/channels')).json()) as SidebarChannel[];
      expect(sidebar.map((c) => c.id)).toContain(channel.id);
    });

    it('changes nothing for a member who joins again', async () => {
      const member = await createStaffMember();
      const channel = await insertChannel({ members: [{ staffId: member.id }] });
      const first = await joinedAt(channel.id, member.id);
      const request = await as(member);
      const res = await request(`/api/channels/${channel.id}/join`, post);
      expect(res.status).toBe(200);
      expect(await joinedAt(channel.id, member.id)).toEqual(first);
    });

    it('answers a Private channel exactly as a missing one', async () => {
      const channel = await insertChannel({ visibility: 'private' });
      const request = await as(await createStaffMember({ role: 'admin' }));
      const hidden = await request(`/api/channels/${channel.id}/join`, post);
      const missing = await request(`/api/channels/${randomUUID()}/join`, post);
      expect(hidden.status).toBe(404);
      expect(missing.status).toBe(404);
      expect(await hidden.json()).toEqual(await missing.json());
    });

    it('sets a new joined_at for someone who left and joins again', async () => {
      const member = await createStaffMember();
      const channel = await insertChannel({
        members: [
          { staffId: (await createStaffMember()).id, channelAdmin: true },
          { staffId: member.id },
        ],
      });
      await asOwner((query) =>
        query(
          `update channel_member set joined_at = '2020-01-01T00:00:00Z'
            where channel_id = $1 and staff_id = $2`,
          [channel.id, member.id],
        ),
      );
      const request = await as(member);
      expect((await request(`/api/channels/${channel.id}/leave`, post)).status).toBe(204);
      expect((await request(`/api/channels/${channel.id}/join`, post)).status).toBe(200);
      expect((await joinedAt(channel.id, member.id))?.getFullYear()).toBeGreaterThan(2020);
    });
  });

  describe('membership changes in audit_event', () => {
    it('records joining, but not joining again, and leaving', async () => {
      const member = await createStaffMember();
      const channel = await insertChannel({
        members: [{ staffId: (await createStaffMember()).id, channelAdmin: true }],
      });
      const request = await as(member);
      await request(`/api/channels/${channel.id}/join`, post);
      await request(`/api/channels/${channel.id}/join`, post);
      expect(await auditOf(channel.id)).toEqual([
        { kind: 'channel_joined', actor_id: member.id, target_staff_id: member.id },
      ]);
      await request(`/api/channels/${channel.id}/leave`, post);
      expect((await auditOf(channel.id)).map((e) => e.kind).sort()).toEqual([
        'channel_joined',
        'channel_left',
      ]);
    });
  });

  describe('POST /api/channels/:channelId/leave', () => {
    it('deletes the membership: the Channel leaves the sidebar and reads as not joined', async () => {
      const member = await createStaffMember();
      const channel = await insertChannel({
        members: [
          { staffId: (await createStaffMember()).id, channelAdmin: true },
          { staffId: member.id },
        ],
      });
      const request = await as(member);
      const res = await request(`/api/channels/${channel.id}/leave`, post);
      expect(res.status).toBe(204);
      expect(await joinedAt(channel.id, member.id)).toBeUndefined();
      const sidebar = (await (await request('/api/channels')).json()) as SidebarChannel[];
      expect(sidebar.map((c) => c.id)).not.toContain(channel.id);
      expect(await (await request(`/api/channels/${channel.id}`)).json()).toMatchObject({
        isMember: false,
      });
    });

    it('takes away a Private channel at once: it then answers 404', async () => {
      const member = await createStaffMember();
      const channel = await insertChannel({
        visibility: 'private',
        members: [
          { staffId: (await createStaffMember()).id, channelAdmin: true },
          { staffId: member.id },
        ],
      });
      const request = await as(member);
      expect((await request(`/api/channels/${channel.id}/leave`, post)).status).toBe(204);
      expect((await request(`/api/channels/${channel.id}`)).status).toBe(404);
      expect((await request(`/api/channels/${channel.id}/leave`, post)).status).toBe(404);
    });

    it('lets a Channel admin leave while another active Channel admin stays', async () => {
      const channelAdmin = await createStaffMember();
      const channel = await insertChannel({
        members: [
          { staffId: channelAdmin.id, channelAdmin: true },
          { staffId: (await createStaffMember()).id, channelAdmin: true },
        ],
      });
      const request = await as(channelAdmin);
      expect((await request(`/api/channels/${channel.id}/leave`, post)).status).toBe(204);
    });

    it('stops the last active Channel admin, counting a Deactivated Channel admin as gone', async () => {
      const channelAdmin = await createStaffMember();
      const gone = await createStaffMember({ deactivated: true });
      const channel = await insertChannel({
        members: [
          { staffId: channelAdmin.id, channelAdmin: true },
          { staffId: gone.id, channelAdmin: true },
          { staffId: (await createStaffMember()).id },
        ],
      });
      const request = await as(channelAdmin);
      const res = await request(`/api/channels/${channel.id}/leave`, post);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: {
          code: 'forbidden',
          message:
            'You’re the last Channel admin here. Make another member Channel admin before you leave.',
        },
      });
      expect(await joinedAt(channel.id, channelAdmin.id)).toBeDefined();
    });

    it('tells the only member to archive the Channel or hand it over', async () => {
      const channelAdmin = await createStaffMember();
      const channel = await insertChannel({
        visibility: 'private',
        members: [{ staffId: channelAdmin.id, channelAdmin: true }],
      });
      const request = await as(channelAdmin);
      const res = await request(`/api/channels/${channel.id}/leave`, post);
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: {
          code: 'forbidden',
          message:
            'You’re the only member of this Channel. Archive it instead, or add someone, make them Channel admin, then leave.',
        },
      });
    });

    it('never leaves a Channel without a Channel admin when its two Channel admins leave at once', async () => {
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
        asA(`/api/channels/${channel.id}/leave`, post),
        asB(`/api/channels/${channel.id}/leave`, post),
      ]);
      expect(responses.map((r) => r.status).sort()).toEqual([204, 403]);
    });
  });
});
