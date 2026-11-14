// The Channel routes through the real app: what they answer, beyond the permission
// matrix's allow and deny statuses.
import { randomUUID } from 'node:crypto';
import type { ChannelView, SidebarChannel } from '@ping/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStaffMember, insertChannel, type StaffFixture } from '../../db/test-support';
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
      });

      const read = await request(`/api/channels/${channel.id}`);
      expect(read.status).toBe(200);
      expect(await read.json()).toEqual(channel);
    });

    it('refuses a missing name with a validation error the UI can show', async () => {
      const request = await as(await createStaffMember());
      const res = await request('/api/channels', {
        method: 'POST',
        body: JSON.stringify({ name: '  ', visibility: 'public' }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: { code: 'validation', message: 'Give the Channel a name.' },
      });
    });

    it('refuses a body that is not JSON with a 400, not a 500', async () => {
      const request = await as(await createStaffMember());
      const res = await request('/api/channels', { method: 'POST', body: '{not json' });
      expect(res.status).toBe(400);
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
        { id: alpha.id, name: 'Alpha', visibility: 'private' },
        { id: zebra.id, name: 'Zebra', visibility: 'public' },
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
});
