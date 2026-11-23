// The Saved and Mute routes, and how Saved Threads and mutes change who gets a Ping,
// through the real app: what they answer, beyond the permission matrix's allow and deny
// statuses. (Mute has no tests file of its own: what it does shows up here, in the Pings.)
import type {
  ChannelView,
  SavedPage,
  SidebarChannel,
  ThreadPage,
  ThreadView,
} from '@ping/shared';
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

/** How many Saved and mute rows a Staff member has in the Channel, read as the owner. */
const attentionOf = async (staffId: string, channelId: string) => {
  const [saved, mutes] = await asOwner((query) =>
    Promise.all([
      query<{ n: number }>(
        'select count(*)::int as n from saved_thread where staff_id = $1 and channel_id = $2',
        [staffId, channelId],
      ),
      query<{ n: number }>(
        'select count(*)::int as n from mute where staff_id = $1 and channel_id = $2',
        [staffId, channelId],
      ),
    ]),
  );
  return { saved: saved.rows[0]?.n, mutes: mutes.rows[0]?.n };
};

describe('Saved and Mute', () => {
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
    return { author, member, channel, base, threadId, thread: `${base}/threads/${threadId}`, respond };
  }

  describe('Saving', () => {
    it('Acknowledges the Ping, and removing from Saved leaves a later one alone', async () => {
      const r = await room();
      const member = await as(r.member);
      expect(await pingsOf(r.threadId)).toEqual({ [r.member.id]: 1 });
      expect((await member(`${r.thread}/saved`, { method: 'PUT' })).status).toBe(204);
      expect(await pingsOf(r.threadId)).toEqual({});
      await r.respond();
      expect(await pingsOf(r.threadId)).toEqual({ [r.member.id]: 1 });
      expect((await member(`${r.thread}/saved`, { method: 'DELETE' })).status).toBe(204);
      expect(await pingsOf(r.threadId)).toEqual({ [r.member.id]: 1 });
    });

    it('lists Saved Threads newest saved first, with the Channel name and the Saved marker', async () => {
      // Channel names are unique, and the database is shared by every test in this file.
      const suffix = Date.now();
      const first = await room('public', `Front desk ${suffix}`);
      const second = await room('public', `Teaching ${suffix}`);
      const reader = await createStaffMember();
      const request = await as(reader);
      await request(`${first.thread}/saved`, { method: 'PUT' });
      await request(`${second.thread}/saved`, { method: 'PUT' });
      // Saving again keeps its place.
      await request(`${first.thread}/saved`, { method: 'PUT' });
      const page = (await (await request('/api/saved')).json()) as SavedPage;
      expect(page.nextCursor).toBeNull();
      expect(
        page.threads.map((t) => ({ id: t.id, channelName: t.channelName, isSaved: t.isSaved })),
      ).toEqual([
        { id: second.threadId, channelName: `Teaching ${suffix}`, isSaved: true },
        { id: first.threadId, channelName: `Front desk ${suffix}`, isSaved: true },
      ]);
    });

    it('marks the Thread Saved on its row and in the Thread view, for the saver only', async () => {
      const r = await room();
      const member = await as(r.member);
      const author = await as(r.author);
      await member(`${r.thread}/saved`, { method: 'PUT' });
      const rows = (await (await member(`${r.base}/threads`)).json()) as ThreadPage;
      expect(rows.threads[0]?.isSaved).toBe(true);
      const view = (await (await member(r.thread)).json()) as ThreadView;
      expect(view.isSaved).toBe(true);
      const theirs = (await (await author(r.thread)).json()) as ThreadView;
      expect(theirs.isSaved).toBe(false);
    });

    it('lists nothing for a Staff member with nothing Saved', async () => {
      const request = await as(await createStaffMember());
      expect(await (await request('/api/saved')).json()).toEqual({ threads: [], nextCursor: null });
    });

    it('answers 404 for a Thread in another Channel', async () => {
      const r = await room();
      const other = await room();
      const member = await as(r.member);
      const res = await member(`${r.base}/threads/${other.threadId}/saved`, { method: 'PUT' });
      expect(res.status).toBe(404);
    });
  });

  describe('who gets a Ping for a new Thread Response', () => {
    it('adds someone who Saved the Thread in a Public channel they aren’t in', async () => {
      const r = await room();
      const reader = await createStaffMember();
      await (await as(reader))(`${r.thread}/saved`, { method: 'PUT' });
      await r.respond();
      expect(await pingsOf(r.threadId)).toEqual({ [r.member.id]: 2, [reader.id]: 1 });
    });

    it('keeps Pinging someone who Saved the Thread after they leave a Public channel', async () => {
      const r = await room();
      const member = await as(r.member);
      await member(`${r.thread}/saved`, { method: 'PUT' });
      expect((await member(`${r.base}/leave`, { method: 'POST' })).status).toBe(204);
      await r.respond();
      expect(await pingsOf(r.threadId)).toEqual({ [r.member.id]: 1 });
    });

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

  describe('losing access', () => {
    async function savedAndMuted(visibility: 'public' | 'private') {
      const r = await room(visibility);
      const member = await as(r.member);
      await member(`${r.thread}/saved`, { method: 'PUT' });
      await member(`${r.base}/mute`, { method: 'PUT' });
      await member(`${r.thread}/mute`, { method: 'PUT' });
      return { ...r, request: member };
    }

    it('keeps Saved and drops mutes when a member leaves a Public channel', async () => {
      const r = await savedAndMuted('public');
      expect((await r.request(`${r.base}/leave`, { method: 'POST' })).status).toBe(204);
      expect(await attentionOf(r.member.id, r.channel.id)).toEqual({ saved: 1, mutes: 0 });
      const page = (await (await r.request('/api/saved')).json()) as SavedPage;
      expect(page.threads.map((t) => t.id)).toEqual([r.threadId]);
    });

    it('drops Saved and mutes when a member leaves a Private channel', async () => {
      const r = await savedAndMuted('private');
      expect((await r.request(`${r.base}/leave`, { method: 'POST' })).status).toBe(204);
      expect(await attentionOf(r.member.id, r.channel.id)).toEqual({ saved: 0, mutes: 0 });
    });

    it('drops Saved and mutes when a Channel admin removes a member from a Private channel', async () => {
      const r = await savedAndMuted('private');
      const author = await as(r.author);
      const res = await author(`${r.base}/members/${r.member.id}`, { method: 'DELETE' });
      expect(res.status).toBe(204);
      expect(await attentionOf(r.member.id, r.channel.id)).toEqual({ saved: 0, mutes: 0 });
    });
  });
});
