// The Mute routes, and how mutes change who gets a Ping, through the real app: what they
// answer, beyond the permission matrix's allow and deny statuses.
import type { ChannelView, SidebarChannel, ThreadView } from '@ping/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asOwner,
  createStaffMember,
  insertChannel,
  type StaffFixture,
} from '../../db/test-support';
import { createTestApp, jsonHeaders, signIn, type TestApp } from '../../test/test-app';

const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

/** staff ID → Ping count for the Thread, read as the owner. */
const pingsOf = async (threadId: string) =>
  Object.fromEntries(
    (
      await asOwner((query) =>
        query<{ staff_id: string; count: number }>(
          'select staff_id, count from ping where thread_id = $1',
          [threadId],
        ),
      )
    ).rows.map((row) => [row.staff_id, row.count]),
  );

describe('Mute', () => {
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

  /** A Channel with its Channel admin (the author), another member, and a Thread. */
  async function room(visibility: 'public' | 'private' = 'public', name?: string) {
    const [author, member] = await Promise.all([createStaffMember(), createStaffMember()]);
    const channel = await insertChannel({
      visibility,
      ...(name ? { name } : {}),
      members: [{ staffId: author.id, channelAdmin: true }, { staffId: member.id }],
    });
    const base = `/api/channels/${channel.id}`;
    const authorRequest = await as(author);
    const res = await authorRequest(`${base}/threads`, {
      method: 'POST',
      body: { title: 'Rota', body: doc('Who has Friday?') },
    });
    expect(res.status).toBe(201);
    const threadId = ((await res.json()) as ThreadView).id;
    const respond = async () => {
      const sent = await authorRequest(`${base}/threads/${threadId}/responses`, {
        method: 'POST',
        body: { body: doc('Anyone?') },
      });
      expect(sent.status).toBe(201);
    };
    return {
      author,
      member,
      channel,
      base,
      threadId,
      thread: `${base}/threads/${threadId}`,
      respond,
    };
  }

  describe('who gets a Ping for a new Thread Response', () => {
    it('skips a member who muted the Channel or the Thread, until they unmute', async () => {
      for (const target of ['channel', 'thread'] as const) {
        const r = await room();
        const member = await as(r.member);
        const path = target === 'channel' ? `${r.base}/mute` : `${r.thread}/mute`;
        await member(`${r.thread}/ping`, { method: 'DELETE' });
        expect((await member(path, { method: 'PUT' })).status).toBe(204);
        // Muting twice changes nothing.
        expect((await member(path, { method: 'PUT' })).status).toBe(204);
        await r.respond();
        expect(await pingsOf(r.threadId)).toEqual({});
        expect((await member(path, { method: 'DELETE' })).status).toBe(204);
        await r.respond();
        expect(await pingsOf(r.threadId)).toEqual({ [r.member.id]: 1 });
      }
    });

    it('still Pings a muted member about a new Thread', async () => {
      const r = await room();
      const member = await as(r.member);
      await member(`${r.base}/mute`, { method: 'PUT' });
      const author = await as(r.author);
      const res = await author(`${r.base}/threads`, {
        method: 'POST',
        body: { title: 'Holidays', body: doc('Dates please') },
      });
      const threadId = ((await res.json()) as ThreadView).id;
      expect(await pingsOf(threadId)).toEqual({ [r.member.id]: 1 });
    });
  });

  describe('showing mutes', () => {
    it('shows a muted Channel in the Channel view and the sidebar', async () => {
      const r = await room();
      const member = await as(r.member);
      await member(`${r.base}/mute`, { method: 'PUT' });
      const view = (await (await member(r.base)).json()) as ChannelView;
      expect(view.isMuted).toBe(true);
      const sidebar = (await (await member('/api/channels')).json()) as SidebarChannel[];
      expect(sidebar.find((c) => c.id === r.channel.id)?.isMuted).toBe(true);
      const author = await as(r.author);
      expect(((await (await author(r.base)).json()) as ChannelView).isMuted).toBe(false);
    });

    it('shows a muted Thread in the Thread view, apart from the Channel mute', async () => {
      const r = await room();
      const member = await as(r.member);
      await member(`${r.base}/mute`, { method: 'PUT' });
      expect(((await (await member(r.thread)).json()) as ThreadView).isMuted).toBe(false);
      await member(`${r.thread}/mute`, { method: 'PUT' });
      expect(((await (await member(r.thread)).json()) as ThreadView).isMuted).toBe(true);
    });
  });
});
