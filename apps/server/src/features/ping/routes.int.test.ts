// The Ping routes, and the Pings the other routes make and clear, through the real app:
// what they answer, beyond the permission matrix's allow and deny statuses.
import { randomUUID } from 'node:crypto';
import type { PingPage, PingSummary, ThreadView } from '@ping/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  asOwner,
  createStaffMember,
  insertChannel,
  insertThread,
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

const pingCountIn = async (channelId: string, staffId: string) =>
  (
    await asOwner((query) =>
      query<{ n: number }>(
        'select count(*)::int as n from ping where channel_id = $1 and staff_id = $2',
        [channelId, staffId],
      ),
    )
  ).rows[0]?.n;

describe('Ping routes and the Pings other routes make', () => {
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

  /** A Channel with its Channel admin (the author) and two more members. */
  async function channelOf(visibility: 'public' | 'private' = 'public') {
    const [author, one, two] = await Promise.all([
      createStaffMember(),
      createStaffMember(),
      createStaffMember(),
    ]);
    const channel = await insertChannel({
      visibility,
      members: [
        { staffId: author.id, channelAdmin: true },
        { staffId: one.id },
        { staffId: two.id },
      ],
    });
    return { author, one, two, channel, base: `/api/channels/${channel.id}` };
  }

  /** The author starts a Thread through the API, which Pings the others. */
  async function startThread(channel: { base: string; author: StaffFixture }) {
    const request = await as(channel.author);
    const res = await request(`${channel.base}/threads`, {
      method: 'POST',
      body: { title: 'Rota', body: doc('Who has Friday?') },
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as ThreadView).id;
  }

  describe('a new Thread', () => {
    it('Pings every other member once, and never the author', async () => {
      const room = await channelOf();
      const threadId = await startThread(room);
      expect(await pingsOf(threadId)).toEqual({ [room.one.id]: 1, [room.two.id]: 1 });
    });

    it('never Pings a Deactivated member', async () => {
      const room = await channelOf();
      await asOwner((query) =>
        query(`update staff_member set deactivated_at = now(), deactivated_by = $2 where id = $1`, [
          room.two.id,
          room.author.id,
        ]),
      );
      const threadId = await startThread(room);
      expect(await pingsOf(threadId)).toEqual({ [room.one.id]: 1 });
    });
  });

  describe('a new Thread Response', () => {
    it('raises each other member’s count, leaves the sender’s Ping alone and clears it', async () => {
      const room = await channelOf();
      const threadId = await startThread(room);
      const one = await as(room.one);
      const res = await one(`${room.base}/threads/${threadId}/responses`, {
        method: 'POST',
        body: { body: doc('I can do Friday') },
      });
      expect(res.status).toBe(201);
      // The author and the other member are Pinged; the sender's own Ping is Acknowledged.
      expect(await pingsOf(threadId)).toEqual({ [room.author.id]: 1, [room.two.id]: 2 });
    });

    it('starts a fresh Ping at 1 after the member Acknowledged', async () => {
      const room = await channelOf();
      const threadId = await startThread(room);
      const two = await as(room.two);
      await two(`${room.base}/threads/${threadId}/ping`, { method: 'DELETE' });
      expect((await pingsOf(threadId))[room.two.id]).toBeUndefined();
      const author = await as(room.author);
      await author(`${room.base}/threads/${threadId}/responses`, {
        method: 'POST',
        body: { body: doc('Anyone?') },
      });
      expect((await pingsOf(threadId))[room.two.id]).toBe(1);
    });

    it('is unchanged by deleting a Thread Response', async () => {
      const room = await channelOf();
      const threadId = await startThread(room);
      const author = await as(room.author);
      const sent = await author(`${room.base}/threads/${threadId}/responses`, {
        method: 'POST',
        body: { body: doc('Sorry, wrong day') },
      });
      const { id } = (await sent.json()) as { id: string };
      const before = await pingsOf(threadId);
      await author(`${room.base}/threads/${threadId}/responses/${id}`, { method: 'DELETE' });
      expect(await pingsOf(threadId)).toEqual(before);
    });
  });

  describe('nothing else Pings', () => {
    it('Pings no one for an edit, a reaction, or a Thread being deleted', async () => {
      const room = await channelOf();
      const threadId = await startThread(room);
      const author = await as(room.author);
      await asOwner((query) => query('delete from ping where thread_id = $1', [threadId]));
      const edit = await author(`${room.base}/threads/${threadId}`, {
        method: 'PATCH',
        body: { title: 'Rota v2', body: doc('Edited') },
      });
      expect(edit.status).toBe(200);
      const react = await author(
        `${room.base}/threads/${threadId}/reactions/${encodeURIComponent('👍')}`,
        { method: 'PUT' },
      );
      expect(react.status).toBe(200);
      expect(await pingsOf(threadId)).toEqual({});
    });
  });

  describe('Acknowledging', () => {
    it('is done by marking read, reacting to the Thread, or reacting to a Thread Response', async () => {
      const room = await channelOf();
      const threadId = await startThread(room);
      const author = await as(room.author);
      const sent = await author(`${room.base}/threads/${threadId}/responses`, {
        method: 'POST',
        body: { body: doc('More details') },
      });
      const { id: responseId } = (await sent.json()) as { id: string };
      expect(await pingsOf(threadId)).toMatchObject({ [room.one.id]: 2, [room.two.id]: 2 });

      const one = await as(room.one);
      const read = await one(`${room.base}/threads/${threadId}/ping`, { method: 'DELETE' });
      expect(read.status).toBe(204);
      expect((await pingsOf(threadId))[room.one.id]).toBeUndefined();

      const two = await as(room.two);
      await two(
        `${room.base}/threads/${threadId}/responses/${responseId}/reactions/${encodeURIComponent('🎉')}`,
        { method: 'PUT' },
      );
      expect((await pingsOf(threadId))[room.two.id]).toBeUndefined();
    });

    it('is not done by viewing the Thread, its Thread Responses, or taking a reaction back', async () => {
      const room = await channelOf();
      const threadId = await startThread(room);
      const one = await as(room.one);
      await one(`${room.base}/threads/${threadId}`);
      await one(`${room.base}/threads/${threadId}/responses`);
      await one(`${room.base}/threads/${threadId}/reactions/${encodeURIComponent('👍')}`, {
        method: 'DELETE',
      });
      expect((await pingsOf(threadId))[room.one.id]).toBe(1);
    });

    it('lets a non-member of a Public channel mark a Thread read, and marking none changes nothing', async () => {
      const room = await channelOf();
      const threadId = await startThread(room);
      const outsider = await createStaffMember();
      await asOwner((query) =>
        query('insert into ping (staff_id, thread_id, channel_id) values ($1, $2, $3)', [
          outsider.id,
          threadId,
          room.channel.id,
        ]),
      );
      const request = await as(outsider);
      expect(
        (await request(`${room.base}/threads/${threadId}/ping`, { method: 'DELETE' })).status,
      ).toBe(204);
      expect((await pingsOf(threadId))[outsider.id]).toBeUndefined();
      expect(
        (await request(`${room.base}/threads/${threadId}/ping`, { method: 'DELETE' })).status,
      ).toBe(204);
    });

    it('answers 404 for a Thread in another Channel', async () => {
      const room = await channelOf();
      const other = await channelOf();
      const threadId = await startThread(room);
      const request = await as(room.one);
      const res = await request(`${other.base}/threads/${threadId}/ping`, { method: 'DELETE' });
      expect(res.status).toBe(404);
    });
  });

  describe('Thread reads', () => {
    it('shows "N new" on the Thread row and the first Ping time on the Thread', async () => {
      const room = await channelOf();
      const threadId = await startThread(room);
      const one = await as(room.one);
      const list = (await (await one(`${room.base}/threads`)).json()) as {
        threads: { id: string; pingCount: number }[];
      };
      expect(list.threads.find((t) => t.id === threadId)?.pingCount).toBe(1);
      const view = (await (await one(`${room.base}/threads/${threadId}`)).json()) as ThreadView;
      expect(view.ping).toMatchObject({ count: 1 });
      expect(Number.isNaN(Date.parse(view.ping?.firstAt ?? ''))).toBe(false);
      const author = await as(room.author);
      const own = (await (await author(`${room.base}/threads/${threadId}`)).json()) as ThreadView;
      expect(own.ping).toBeNull();
    });
  });

  describe('GET /api/pings and /api/pings/summary', () => {
    it('lists Threads with a Ping, newest activity first, with the Channel name', async () => {
      const room = await channelOf();
      const first = await startThread(room);
      const second = await startThread(room);
      const author = await as(room.author);
      await author(`${room.base}/threads/${first}/responses`, {
        method: 'POST',
        body: { body: doc('Bump') },
      });
      const one = await as(room.one);
      const page = (await (await one('/api/pings')).json()) as PingPage;
      const ids = page.threads.filter((t) => [first, second].includes(t.id)).map((t) => t.id);
      expect(ids).toEqual([first, second]);
      const row = page.threads.find((t) => t.id === first);
      expect(row).toMatchObject({ channelName: room.channel.name, pingCount: 2 });
      expect(page.nextCursor).toBeNull();
    });

    it('counts Threads with a Ping, in all and per Channel', async () => {
      const room = await channelOf();
      await startThread(room);
      await startThread(room);
      const one = await as(room.one);
      const summary = (await (await one('/api/pings/summary')).json()) as PingSummary;
      expect(summary.channels).toContainEqual({ channelId: room.channel.id, count: 2 });
      expect(summary.threadCount).toBeGreaterThanOrEqual(2);
      const author = await as(room.author);
      const own = (await (await author('/api/pings/summary')).json()) as PingSummary;
      expect(own).toEqual({ threadCount: 0, channels: [] });
    });

    it('lists nothing for a Staff member with no Pings', async () => {
      const lonely = await createStaffMember();
      const request = await as(lonely);
      expect(await (await request('/api/pings')).json()).toEqual({ threads: [], nextCursor: null });
    });
  });

  describe('losing access', () => {
    it('keeps a member’s Pings when they leave a Public channel', async () => {
      const room = await channelOf('public');
      await startThread(room);
      const one = await as(room.one);
      expect((await one(`${room.base}/leave`, { method: 'POST' })).status).toBe(204);
      expect(await pingCountIn(room.channel.id, room.one.id)).toBe(1);
    });

    it('drops a member’s Pings when they leave a Private channel', async () => {
      const room = await channelOf('private');
      await startThread(room);
      const one = await as(room.one);
      expect((await one(`${room.base}/leave`, { method: 'POST' })).status).toBe(204);
      expect(await pingCountIn(room.channel.id, room.one.id)).toBe(0);
      expect(await pingCountIn(room.channel.id, room.two.id)).toBe(1);
    });

    it('drops a member’s Pings when a Channel admin removes them from a Private channel', async () => {
      const room = await channelOf('private');
      await startThread(room);
      const author = await as(room.author);
      const res = await author(`${room.base}/members/${room.two.id}`, { method: 'DELETE' });
      expect(res.status).toBe(204);
      expect(await pingCountIn(room.channel.id, room.two.id)).toBe(0);
      expect(await pingCountIn(room.channel.id, room.one.id)).toBe(1);
    });

    it('back-fills nothing when someone joins a Public channel', async () => {
      const room = await channelOf('public');
      await startThread(room);
      const joiner = await createStaffMember();
      const request = await as(joiner);
      expect((await request(`${room.base}/join`, { method: 'POST' })).status).toBe(200);
      expect(await pingCountIn(room.channel.id, joiner.id)).toBe(0);
    });
  });

  describe('a failed fan-out', () => {
    /** Makes every insert into ping fail, until `restore` runs. */
    async function breakPings() {
      await asOwner(async (query) => {
        await query(`create function public.fail_ping_insert() returns trigger
          language plpgsql as $$ begin raise exception 'ping insert refused'; end $$`);
        await query(`create trigger fail_ping_insert before insert on ping
          for each row execute function public.fail_ping_insert()`);
      });
      return () =>
        asOwner(async (query) => {
          await query('drop trigger if exists fail_ping_insert on ping');
          await query('drop function if exists public.fail_ping_insert()');
        });
    }

    it('leaves no Thread behind', async () => {
      const room = await channelOf();
      const request = await as(room.author);
      const restore = await breakPings();
      const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        const res = await request(`${room.base}/threads`, {
          method: 'POST',
          body: { title: `Doomed ${randomUUID()}`, body: doc('Never lands') },
        });
        expect(res.status).toBe(500);
      } finally {
        logged.mockRestore();
        await restore();
      }
      const left = await asOwner((query) =>
        query<{ n: number }>('select count(*)::int as n from thread where channel_id = $1', [
          room.channel.id,
        ]),
      );
      expect(left.rows[0]?.n).toBe(0);
    });

    it('leaves no Thread Response behind', async () => {
      const room = await channelOf();
      const thread = await insertThread({ channelId: room.channel.id, authorId: room.author.id });
      const request = await as(room.one);
      const restore = await breakPings();
      const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        const res = await request(`${room.base}/threads/${thread.id}/responses`, {
          method: 'POST',
          body: { body: doc('Never lands') },
        });
        expect(res.status).toBe(500);
      } finally {
        logged.mockRestore();
        await restore();
      }
      const left = await asOwner((query) =>
        query<{ n: number }>(
          'select count(*)::int as n from thread_response where thread_id = $1',
          [thread.id],
        ),
      );
      expect(left.rows[0]?.n).toBe(0);
    });
  });
});
