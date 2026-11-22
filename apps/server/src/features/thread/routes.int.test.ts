// The Thread routes through the real app: what they answer, beyond the permission
// matrix's allow and deny statuses.
import { randomUUID } from 'node:crypto';
import type { ThreadPage, ThreadView } from '@ping/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asOwner,
  createStaffMember,
  insertChannel,
  insertThread,
  type StaffFixture,
} from '../../db/test-support';
import { createTestApp, jsonHeaders, signIn, type TestApp } from '../../test/test-app';

const description = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Since Monday' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Room 2 is ', marks: [{ type: 'bold' }] },
        { type: 'text', text: 'cold' },
      ],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Call the plumber' }] }],
        },
      ],
    },
  ],
};

describe('Thread routes', () => {
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

  async function memberOfNewChannel() {
    const staff = await createStaffMember();
    const channel = await insertChannel({ members: [{ staffId: staff.id, channelAdmin: true }] });
    return { staff, channel, request: await as(staff) };
  }

  describe('POST /api/channels/:channelId/threads', () => {
    it('starts a Thread, trimming its title, and extracts its plain text', async () => {
      const { staff, channel, request } = await memberOfNewChannel();
      const res = await request(`/api/channels/${channel.id}/threads`, {
        method: 'POST',
        body: JSON.stringify({ title: '  Heater broken ', body: description }),
      });
      expect(res.status).toBe(201);
      const started = (await res.json()) as ThreadView;
      expect(started).toEqual({
        id: expect.any(String),
        channelId: channel.id,
        title: 'Heater broken',
        body: description,
        author: { staffId: staff.id, name: staff.name, isDeactivated: false },
        isSystem: false,
        createdAt: expect.any(String),
        latestActivityAt: started.createdAt,
      });

      const stored = await asOwner((query) =>
        query<{ body_text: string; search_matches: boolean }>(
          `select body_text, search @@ plainto_tsquery('english', 'plumber heater') as search_matches
             from thread where id = $1`,
          [started.id],
        ),
      );
      expect(stored.rows[0]).toEqual({
        body_text: 'Since Monday\nRoom 2 is cold\nCall the plumber',
        search_matches: true,
      });

      const read = await request(`/api/channels/${channel.id}/threads/${started.id}`);
      expect(read.status).toBe(200);
      expect(await read.json()).toEqual(started);
    });

    it('refuses a description outside the allowlist, whatever the front end sent', async () => {
      const { channel, request } = await memberOfNewChannel();
      const res = await request(`/api/channels/${channel.id}/threads`, {
        method: 'POST',
        body: JSON.stringify({
          title: 'Sneaky',
          body: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  {
                    type: 'text',
                    text: 'click',
                    marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
                  },
                ],
              },
            ],
          },
        }),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: {
          code: 'validation',
          message: 'Links must start with http://, https:// or mailto:.',
          issues: [
            { path: 'body', message: 'Links must start with http://, https:// or mailto:.' },
          ],
        },
      });
      const count = await asOwner((query) =>
        query('select 1 from thread where channel_id = $1', [channel.id]),
      );
      expect(count.rowCount).toBe(0);
    });

    it('tells a non-member of a Public channel to join first', async () => {
      const channel = await insertChannel({ visibility: 'public' });
      const request = await as(await createStaffMember());
      const res = await request(`/api/channels/${channel.id}/threads`, {
        method: 'POST',
        body: JSON.stringify({ title: 'Hello' }),
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: { code: 'forbidden', message: 'Join this Channel to start a Thread in it.' },
      });
    });
  });

  describe('GET /api/channels/:channelId/threads', () => {
    it('lists Threads by Latest activity, newest first, with author and a preview', async () => {
      const { staff, channel, request } = await memberOfNewChannel();
      const now = Date.now();
      const older = await insertThread({
        channelId: channel.id,
        authorId: staff.id,
        title: 'Older',
        bodyText: 'First line\nsecond   line',
        latestActivityAt: new Date(now - 60_000),
      });
      const newer = await insertThread({
        channelId: channel.id,
        authorId: staff.id,
        title: 'Newer',
        latestActivityAt: new Date(now),
      });
      const res = await request(`/api/channels/${channel.id}/threads`);
      expect(res.status).toBe(200);
      const page = (await res.json()) as ThreadPage;
      expect(page.nextCursor).toBeNull();
      expect(page.threads.map((t) => t.id)).toEqual([newer.id, older.id]);
      expect(page.threads[1]).toEqual({
        id: older.id,
        channelId: channel.id,
        title: 'Older',
        preview: 'First line second line',
        author: { staffId: staff.id, name: staff.name, isDeactivated: false },
        isSystem: false,
        createdAt: new Date(now - 60_000).toISOString(),
        latestActivityAt: new Date(now - 60_000).toISOString(),
      });
    });

    it('loads 50 at a time, and the next page starts after the cursor', async () => {
      const { staff, channel, request } = await memberOfNewChannel();
      const now = Date.now();
      for (let i = 0; i < 52; i++) {
        await insertThread({
          channelId: channel.id,
          authorId: staff.id,
          title: `Thread ${i}`,
          latestActivityAt: new Date(now - i * 1000),
        });
      }
      const first = (await (
        await request(`/api/channels/${channel.id}/threads`)
      ).json()) as ThreadPage;
      expect(first.threads).toHaveLength(50);
      expect(first.threads[0]?.title).toBe('Thread 0');
      expect(first.nextCursor).toBe(first.threads[49]?.id);

      const second = (await (
        await request(`/api/channels/${channel.id}/threads?after=${first.nextCursor}`)
      ).json()) as ThreadPage;
      expect(second.threads.map((t) => t.title)).toEqual(['Thread 50', 'Thread 51']);
      expect(second.nextCursor).toBeNull();
    });

    it('marks a Deactivated author', async () => {
      const { channel, request } = await memberOfNewChannel();
      const gone = await createStaffMember({ deactivated: true });
      await insertThread({ channelId: channel.id, authorId: gone.id });
      const page = (await (
        await request(`/api/channels/${channel.id}/threads`)
      ).json()) as ThreadPage;
      expect(page.threads[0]?.author).toEqual({
        staffId: gone.id,
        name: gone.name,
        isDeactivated: true,
      });
    });
  });

  describe('GET /api/channels/:channelId/threads/:threadId', () => {
    it('answers 404 for a Thread in another Channel, like a missing one', async () => {
      const { staff, channel, request } = await memberOfNewChannel();
      const elsewhere = await insertChannel({
        members: [{ staffId: staff.id, channelAdmin: true }],
      });
      const thread = await insertThread({ channelId: elsewhere.id, authorId: staff.id });
      expect((await request(`/api/channels/${channel.id}/threads/${thread.id}`)).status).toBe(404);
      expect((await request(`/api/channels/${channel.id}/threads/${randomUUID()}`)).status).toBe(
        404,
      );
    });
  });
});
