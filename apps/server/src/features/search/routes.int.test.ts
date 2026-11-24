// The search routes through the real app: what they find and what they never find, beyond
// the permission matrix's allow and deny statuses (product.md › Search).
import { randomUUID } from 'node:crypto';
import {
  type ChannelSearchResults,
  type SearchPeople,
  THREAD_PAGE_SIZE,
  type ThreadSearchPage,
  type ThreadView,
} from '@ping/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asOwner,
  createInvitedStaffMember,
  createStaffMember,
  insertAttachment,
  insertChannel,
  insertThread,
  insertThreadResponse,
  type StaffFixture,
} from '../../db/test-support';
import { createTestApp, jsonHeaders, signIn, type TestApp } from '../../test/test-app';

/**
 * A word no other test uses: every test in this file shares one database, and search
 * reaches every Public channel. Letters only, so stemming leaves it alone.
 */
const unique = () =>
  `q${randomUUID()
    .replaceAll('-', '')
    .slice(0, 10)
    .replace(/[0-9]/g, (d) => 'ghijklmnop'[Number(d)] ?? 'g')}`;

const at = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000);

describe('Search', () => {
  let testApp: TestApp;
  beforeAll(() => {
    testApp = createTestApp();
  });
  afterAll(async () => {
    await testApp.close();
  });

  async function as(staff: StaffFixture) {
    const cookie = await signIn(testApp, staff);
    const request = (path: string, init: { method?: string; body?: unknown } = {}) =>
      testApp.app.request(path, {
        method: init.method ?? 'GET',
        headers: jsonHeaders({ cookie }),
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
      });
    const threads = async (query: Record<string, string>) => {
      const res = await request(`/api/search/threads?${new URLSearchParams(query)}`);
      expect(res.status).toBe(200);
      return (await res.json()) as ThreadSearchPage;
    };
    const channels = async (q: string) => {
      const res = await request(`/api/search/channels?${new URLSearchParams({ q })}`);
      expect(res.status).toBe(200);
      return (await res.json()) as ChannelSearchResults;
    };
    return { request, threads, channels };
  }

  const idsOf = (page: ThreadSearchPage) => page.threads.map((t) => t.id);

  /** A Public channel with one member, who started its Threads. */
  async function publicChannel(options: { name?: string; archived?: boolean } = {}) {
    const author = await createStaffMember();
    const channel = await insertChannel({
      ...options,
      members: [{ staffId: author.id, channelAdmin: true }],
    });
    return { author, channel };
  }

  describe('Matching', () => {
    it('matches a Thread’s title and description, with English stemming', async () => {
      const word = unique();
      const { author, channel } = await publicChannel();
      const byTitle = await insertThread({
        channelId: channel.id,
        authorId: author.id,
        title: `${word} booking`,
      });
      const byDescription = await insertThread({
        channelId: channel.id,
        authorId: author.id,
        bodyText: `Rooms ${word} booked for Friday`,
      });
      const { threads } = await as(await createStaffMember());
      expect(new Set(idsOf(await threads({ q: `${word} books` })))).toEqual(
        new Set([byTitle.id, byDescription.id]),
      );
    });

    it('needs every word, and matches the last one as a prefix', async () => {
      const word = unique();
      const { author, channel } = await publicChannel();
      const both = await insertThread({
        channelId: channel.id,
        authorId: author.id,
        title: `${word} heating engineer`,
      });
      await insertThread({ channelId: channel.id, authorId: author.id, title: `${word} heating` });
      const { threads } = await as(await createStaffMember());
      expect(idsOf(await threads({ q: `${word} engin` }))).toEqual([both.id]);
      expect(idsOf(await threads({ q: `${word} engineer plumber` }))).toEqual([]);
    });

    it('matches a Channel’s name and description', async () => {
      const word = unique();
      const named = await insertChannel({ name: `Front desk ${word}` });
      const described = await insertChannel();
      await asOwner((query) =>
        query('update channel set description = $2 where id = $1', [
          described.id,
          `Visitors and ${word} deliveries`,
        ]),
      );
      const { channels } = await as(await createStaffMember());
      expect(new Set((await channels(word)).channels.map((c) => c.id))).toEqual(
        new Set([named.id, described.id]),
      );
    });

    it('matches a last word typed so far that is a stop word as a prefix, not as nothing', async () => {
      const word = unique();
      const { author, channel } = await publicChannel();
      const office = await insertThread({
        channelId: channel.id,
        authorId: author.id,
        title: `${word} office`,
      });
      await insertThread({ channelId: channel.id, authorId: author.id, title: `${word} rota` });
      const { threads } = await as(await createStaffMember());
      // "of" on the way to "office" narrows the results; it isn't dropped as a stop word.
      expect(idsOf(await threads({ q: `${word} of` }))).toEqual([office.id]);
    });

    it('answers, without failing, when only stop words or punctuation are typed', async () => {
      const { request } = await as(await createStaffMember());
      for (const q of ['the and', 'of the']) {
        expect((await request(`/api/search/threads?${new URLSearchParams({ q })}`)).status).toBe(
          200,
        );
        expect((await request(`/api/search/channels?${new URLSearchParams({ q })}`)).status).toBe(
          200,
        );
      }
      const punctuation = await request(`/api/search/threads?${new URLSearchParams({ q: '&|!' })}`);
      expect(await punctuation.json()).toEqual({ threads: [], nextCursor: null });
    });
  });

  describe('Never matches', () => {
    it('people’s names: an author’s, or a Mention’s', async () => {
      const surname = unique();
      const named = await createStaffMember({ name: `Laura ${surname}` });
      const channel = await insertChannel({
        members: [{ staffId: named.id, channelAdmin: true }],
      });
      await insertThread({ channelId: channel.id, authorId: named.id, title: 'Heater' });
      const { request, threads } = await as(named);
      const started = await request(`/api/channels/${channel.id}/threads`, {
        method: 'POST',
        body: {
          title: 'Boiler',
          body: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [
                  { type: 'text', text: 'Ask ' },
                  {
                    type: 'mention',
                    attrs: { id: named.id, label: named.name, mentionSuggestionChar: '@' },
                  },
                  { type: 'text', text: ' about the boiler' },
                ],
              },
            ],
          },
        },
      });
      expect(started.status).toBe(201);
      const threadId = ((await started.json()) as ThreadView).id;
      expect((await threads({ q: surname })).threads).toEqual([]);
      // The words around the Mention still match.
      expect(idsOf(await threads({ q: 'ask about boiler' }))).toContain(threadId);
    });

    it('Attachment filenames', async () => {
      const word = unique();
      const { author, channel } = await publicChannel();
      const thread = await insertThread({ channelId: channel.id, authorId: author.id });
      await insertAttachment({
        uploaderId: author.id,
        channelId: channel.id,
        threadId: thread.id,
        filename: `${word}.pdf`,
      });
      const { threads } = await as(await createStaffMember());
      expect((await threads({ q: word })).threads).toEqual([]);
    });

    it('deleted Thread Responses or deleted Threads', async () => {
      const word = unique();
      const { author, channel } = await publicChannel();
      const kept = await insertThread({ channelId: channel.id, authorId: author.id });
      const response = await insertThreadResponse({
        threadId: kept.id,
        channelId: channel.id,
        authorId: author.id,
        bodyText: `${word} spare keys`,
      });
      const gone = await insertThread({
        channelId: channel.id,
        authorId: author.id,
        title: `${word} spare keys`,
      });
      const { request, threads } = await as(author);
      expect(new Set(idsOf(await threads({ q: word })))).toEqual(new Set([kept.id, gone.id]));
      const base = `/api/channels/${channel.id}/threads`;
      expect(
        (await request(`${base}/${kept.id}/responses/${response.id}`, { method: 'DELETE' })).status,
      ).toBe(204);
      expect((await request(`${base}/${gone.id}`, { method: 'DELETE' })).status).toBe(204);
      expect((await threads({ q: word })).threads).toEqual([]);
    });
  });

  describe('Visibility', () => {
    async function privateRoom(word: string) {
      const [member, adminMember] = await Promise.all([
        createStaffMember(),
        createStaffMember({ role: 'admin' }),
      ]);
      const channel = await insertChannel({
        visibility: 'private',
        name: `Owners ${word}`,
        members: [{ staffId: member.id, channelAdmin: true }, { staffId: adminMember.id }],
      });
      const thread = await insertThread({
        channelId: channel.id,
        authorId: member.id,
        title: `${word} accounts`,
      });
      const other = await insertThread({ channelId: channel.id, authorId: member.id });
      await insertThreadResponse({
        threadId: other.id,
        channelId: channel.id,
        authorId: member.id,
        bodyText: `${word} payroll`,
      });
      return { channel, member, adminMember, threadIds: [thread.id, other.id] };
    }

    it.each([
      ['a Member', 'member'],
      ['a company Admin', 'admin'],
    ] as const)(
      'keeps a Private channel’s Channel, Threads and Thread Responses from %s who isn’t in it',
      async (_name, role) => {
        const word = unique();
        const room = await privateRoom(word);
        const { request, threads, channels } = await as(await createStaffMember({ role }));
        expect((await channels(word)).channels).toEqual([]);
        expect((await threads({ q: word })).threads).toEqual([]);
        // Naming it in the In chip doesn't reach it either: it's not found.
        const inIt = await request(
          `/api/search/threads?${new URLSearchParams({ q: word, in: room.channel.id })}`,
        );
        expect(inIt.status).toBe(404);
      },
    );

    it('finds a Private channel’s content for its members, company Admins included', async () => {
      const word = unique();
      const room = await privateRoom(word);
      for (const staff of [room.member, room.adminMember]) {
        const { threads, channels } = await as(staff);
        expect((await channels(word)).channels.map((c) => c.id)).toEqual([room.channel.id]);
        expect(new Set(idsOf(await threads({ q: word })))).toEqual(new Set(room.threadIds));
        expect(new Set(idsOf(await threads({ q: word, in: room.channel.id })))).toEqual(
          new Set(room.threadIds),
        );
      }
    });

    it('still finds content by a Deactivated Staff member', async () => {
      const word = unique();
      const { channel } = await publicChannel();
      const gone = await createStaffMember({ deactivated: true });
      const thread = await insertThread({
        channelId: channel.id,
        authorId: gone.id,
        title: `${word} handover`,
      });
      const { threads } = await as(await createStaffMember());
      const [result] = (await threads({ q: word })).threads;
      expect(result?.id).toBe(thread.id);
      expect(result?.author).toEqual({ staffId: gone.id, name: gone.name, isDeactivated: true });
    });
  });

  describe('Results', () => {
    it('shows each Thread once, with the matching Thread Response’s snippet', async () => {
      const word = unique();
      const { author, channel } = await publicChannel();
      const thread = await insertThread({
        channelId: channel.id,
        authorId: author.id,
        title: 'Rota',
      });
      await insertThreadResponse({
        threadId: thread.id,
        channelId: channel.id,
        authorId: author.id,
        bodyText: `First ${word} note`,
        createdAt: at(10),
      });
      const latest = await insertThreadResponse({
        threadId: thread.id,
        channelId: channel.id,
        authorId: author.id,
        bodyText: `Moved the ${word} to Monday`,
        createdAt: at(5),
      });
      const { threads } = await as(await createStaffMember());
      const page = await threads({ q: word });
      expect(page.threads).toHaveLength(1);
      expect(page.threads[0]?.response?.id).toBe(latest.id);
      expect(page.threads[0]?.response?.author.staffId).toBe(author.id);
      expect(page.threads[0]?.snippet).toEqual([
        { text: 'Moved the ', match: false },
        { text: word, match: true },
        { text: ' to Monday', match: false },
      ]);
    });

    it('prefers the Thread’s own match, with its description as the snippet', async () => {
      const word = unique();
      const { author, channel } = await publicChannel();
      const thread = await insertThread({
        channelId: channel.id,
        authorId: author.id,
        title: `${word} rota`,
        bodyText: 'Who covers Friday?',
      });
      await insertThreadResponse({
        threadId: thread.id,
        channelId: channel.id,
        authorId: author.id,
        bodyText: `${word} again`,
      });
      const { threads } = await as(await createStaffMember());
      const [result] = (await threads({ q: word })).threads;
      expect(result?.response).toBeNull();
      expect(result?.snippet).toEqual([{ text: 'Who covers Friday?', match: false }]);
    });

    it('sorts by Latest activity, newest first, and marks Archived channels', async () => {
      const word = unique();
      const { author, channel } = await publicChannel();
      const archived = await publicChannel({ archived: true, name: `Old ${word}` });
      const older = await insertThread({
        channelId: channel.id,
        authorId: author.id,
        title: word,
        latestActivityAt: at(30),
      });
      const newer = await insertThread({
        channelId: archived.channel.id,
        authorId: archived.author.id,
        title: word,
        latestActivityAt: at(1),
      });
      const { threads, channels } = await as(await createStaffMember());
      const page = await threads({ q: word });
      expect(page.threads.map((t) => [t.id, t.channelIsArchived])).toEqual([
        [newer.id, true],
        [older.id, false],
      ]);
      expect(page.threads[0]?.channelName).toBe(`Old ${word}`);
      expect((await channels(word)).channels).toEqual([
        expect.objectContaining({ id: archived.channel.id, isArchived: true, isMember: false }),
      ]);
    });

    it('sorts Channels by the Latest activity of their Threads', async () => {
      const word = unique();
      const quiet = await publicChannel({ name: `${word} quiet` });
      const busy = await publicChannel({ name: `${word} busy` });
      await insertThread({
        channelId: quiet.channel.id,
        authorId: quiet.author.id,
        latestActivityAt: at(60),
      });
      await insertThread({
        channelId: busy.channel.id,
        authorId: busy.author.id,
        latestActivityAt: at(1),
      });
      const { channels } = await as(await createStaffMember());
      expect((await channels(word)).channels.map((c) => c.id)).toEqual([
        busy.channel.id,
        quiet.channel.id,
      ]);
    });

    it('loads Threads 50 at a time', async () => {
      const word = unique();
      const { author, channel } = await publicChannel();
      const ids: string[] = [];
      for (let i = 0; i <= THREAD_PAGE_SIZE; i++) {
        const thread = await insertThread({
          channelId: channel.id,
          authorId: author.id,
          title: word,
          latestActivityAt: at(i),
        });
        ids.push(thread.id);
      }
      const { threads } = await as(await createStaffMember());
      const first = await threads({ q: word });
      expect(idsOf(first)).toEqual(ids.slice(0, THREAD_PAGE_SIZE));
      expect(first.nextCursor).toBe(ids[THREAD_PAGE_SIZE - 1]);
      const second = await threads({ q: word, after: first.nextCursor ?? '' });
      expect(idsOf(second)).toEqual(ids.slice(THREAD_PAGE_SIZE));
      expect(second.nextCursor).toBeNull();
    });

    it('loads a smaller page when asked, as the search dialog does', async () => {
      const word = unique();
      const { author, channel } = await publicChannel();
      const ids: string[] = [];
      for (let i = 0; i < 7; i++) {
        const thread = await insertThread({
          channelId: channel.id,
          authorId: author.id,
          title: word,
          latestActivityAt: at(i),
        });
        ids.push(thread.id);
      }
      const { threads } = await as(await createStaffMember());
      const first = await threads({ q: word, limit: '5' });
      expect(idsOf(first)).toEqual(ids.slice(0, 5));
      expect(first.nextCursor).toBe(ids[4]);
      const second = await threads({ q: word, limit: '5', after: first.nextCursor ?? '' });
      expect(idsOf(second)).toEqual(ids.slice(5));
      expect(second.nextCursor).toBeNull();
    });

    it.each(['0', '51', '2.5', 'abc'])('refuses a page of %s Threads', async (limit) => {
      const { request } = await as(await createStaffMember());
      const res = await request(`/api/search/threads?${new URLSearchParams({ q: 'rota', limit })}`);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({
        error: { issues: [{ path: 'limit', message: 'Ask for 1 to 50 Threads.' }] },
      });
    });
  });

  describe('Chips', () => {
    it('Status: Resolved threads by default, or only Open or only Resolved', async () => {
      const word = unique();
      const { author, channel } = await publicChannel();
      const open = await insertThread({ channelId: channel.id, authorId: author.id, title: word });
      const resolved = await insertThread({
        channelId: channel.id,
        authorId: author.id,
        title: word,
        resolved: true,
      });
      const { threads } = await as(await createStaffMember());
      expect(new Set(idsOf(await threads({ q: word })))).toEqual(new Set([open.id, resolved.id]));
      expect(idsOf(await threads({ q: word, status: 'open' }))).toEqual([open.id]);
      expect(idsOf(await threads({ q: word, status: 'resolved' }))).toEqual([resolved.id]);
    });

    it('In: one Channel', async () => {
      const word = unique();
      const one = await publicChannel();
      const two = await publicChannel();
      const inOne = await insertThread({
        channelId: one.channel.id,
        authorId: one.author.id,
        title: word,
      });
      await insertThread({ channelId: two.channel.id, authorId: two.author.id, title: word });
      const { threads } = await as(await createStaffMember());
      expect(idsOf(await threads({ q: word, in: one.channel.id }))).toEqual([inOne.id]);
    });

    it('From: what that person wrote, a Deactivated Staff member included', async () => {
      const word = unique();
      const { author, channel } = await publicChannel();
      const from = await createStaffMember({ deactivated: true });
      const theirThread = await insertThread({
        channelId: channel.id,
        authorId: from.id,
        title: word,
      });
      const othersThread = await insertThread({
        channelId: channel.id,
        authorId: author.id,
        title: word,
      });
      const theirResponse = await insertThreadResponse({
        threadId: othersThread.id,
        channelId: channel.id,
        authorId: from.id,
        bodyText: `${word} from them`,
      });
      await insertThread({ channelId: channel.id, authorId: author.id, title: `${word} other` });
      const { threads } = await as(await createStaffMember());
      const page = await threads({ q: word, from: from.id });
      expect(new Set(idsOf(page))).toEqual(new Set([theirThread.id, othersThread.id]));
      // Another person's Thread is found through their Thread Response.
      expect(page.threads.find((t) => t.id === othersThread.id)?.response?.id).toBe(
        theirResponse.id,
      );
    });
  });

  describe('GET /api/search/people', () => {
    it('lists everyone who has joined, Deactivated included, but not Invited people', async () => {
      const [active, deactivated, invited] = await Promise.all([
        createStaffMember(),
        createStaffMember({ deactivated: true }),
        createInvitedStaffMember(),
      ]);
      const { request } = await as(active);
      const res = await request('/api/search/people');
      expect(res.status).toBe(200);
      const { people } = (await res.json()) as SearchPeople;
      expect(people).toContainEqual({
        staffId: active.id,
        name: active.name,
        isDeactivated: false,
      });
      expect(people).toContainEqual({
        staffId: deactivated.id,
        name: deactivated.name,
        isDeactivated: true,
      });
      expect(people.map((p) => p.staffId)).not.toContain(invited.id);
    });
  });
});
