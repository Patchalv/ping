// Mentions through the real app: the @ picker's list, and what a Mention does when a
// Thread or Thread Response is saved, beyond the permission matrix's statuses.
import type {
  MentionCandidateList,
  PingPage,
  ThreadPage,
  ThreadResponseList,
  ThreadResponseView,
  ThreadView,
} from '@ping/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asOwner,
  createInvitedStaffMember,
  createStaffMember,
  insertChannel,
  insertThread,
  type StaffFixture,
} from '../../db/test-support';
import { createTestApp, jsonHeaders, signIn, type TestApp } from '../../test/test-app';

const mentioning = (...people: StaffFixture[]) => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'Over to ' },
        ...people.map((p) => ({
          type: 'mention',
          attrs: { id: p.id, label: p.name, mentionSuggestionChar: '@' },
        })),
      ],
    },
  ],
});

describe('Mentions', () => {
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

  /** The viewer's open Ping count on a Thread, from their Pings view; 0 with none. */
  async function pingCountFor(staff: StaffFixture, threadId: string): Promise<number> {
    const res = await (await as(staff))('/api/pings');
    const page = (await res.json()) as PingPage;
    return page.threads.find((t) => t.id === threadId)?.pingCount ?? 0;
  }

  async function isMember(channelId: string, staffId: string) {
    const result = await asOwner((query) =>
      query('select 1 from channel_member where channel_id = $1 and staff_id = $2', [
        channelId,
        staffId,
      ]),
    );
    return result.rowCount === 1;
  }

  async function channelOf(visibility: 'public' | 'private', ...members: StaffFixture[]) {
    const author = await createStaffMember();
    const channel = await insertChannel({
      visibility,
      members: [
        { staffId: author.id, channelAdmin: true },
        ...members.map((m) => ({ staffId: m.id })),
      ],
    });
    return { author, channel, request: await as(author) };
  }

  describe('GET /api/channels/:channelId/mention-candidates', () => {
    it('lists every active Staff member for a Public channel, members or not', async () => {
      const member = await createStaffMember();
      const outsider = await createStaffMember();
      const invited = await createInvitedStaffMember();
      const deactivated = await createStaffMember({ deactivated: true });
      const { author, channel, request } = await channelOf('public', member, deactivated);
      const res = await request(`/api/channels/${channel.id}/mention-candidates`);
      expect(res.status).toBe(200);
      const ids = ((await res.json()) as MentionCandidateList).candidates.map((c) => c.staffId);
      expect(ids).toEqual(expect.arrayContaining([author.id, member.id, outsider.id]));
      expect(ids).not.toContain(invited.id);
      expect(ids).not.toContain(deactivated.id);
    });

    it('lists only active Channel members for a Private channel', async () => {
      const member = await createStaffMember();
      const outsider = await createStaffMember();
      const deactivated = await createStaffMember({ deactivated: true });
      const { author, channel, request } = await channelOf('private', member, deactivated);
      const res = await request(`/api/channels/${channel.id}/mention-candidates`);
      const { candidates } = (await res.json()) as MentionCandidateList;
      expect(candidates.map((c) => c.staffId).sort()).toEqual([author.id, member.id].sort());
      expect(candidates.find((c) => c.staffId === member.id)?.name).toBe(member.name);
      expect(candidates.map((c) => c.staffId)).not.toContain(outsider.id);
    });
  });

  describe('starting a Thread', () => {
    it('Pings a Mentioned non-member of a Public channel without making them join', async () => {
      const outsider = await createStaffMember();
      const { channel, request } = await channelOf('public');
      const res = await request(`/api/channels/${channel.id}/threads`, {
        method: 'POST',
        body: { title: 'Heater', body: mentioning(outsider) },
      });
      expect(res.status).toBe(201);
      const started = (await res.json()) as ThreadView;
      expect(started.mentionNames).toEqual({ [outsider.id]: outsider.name });
      expect(await pingCountFor(outsider, started.id)).toBe(1);
      expect(await isMember(channel.id, outsider.id)).toBe(false);
    });

    it('Pings a Mentioned member once, not twice', async () => {
      const member = await createStaffMember();
      const { channel, request } = await channelOf('public', member);
      const res = await request(`/api/channels/${channel.id}/threads`, {
        method: 'POST',
        body: { title: 'Heater', body: mentioning(member) },
      });
      const started = (await res.json()) as ThreadView;
      expect(await pingCountFor(member, started.id)).toBe(1);
    });

    it.each([
      ['a non-member of a Private channel', 'private', () => createStaffMember()],
      ['an Invited Staff member', 'public', () => createInvitedStaffMember()],
      ['a Deactivated Staff member', 'public', () => createStaffMember({ deactivated: true })],
    ] as const)('refuses a Mention of %s and starts nothing', async (_n, visibility, create) => {
      const target = await create();
      const { channel, request } = await channelOf(visibility);
      const res = await request(`/api/channels/${channel.id}/threads`, {
        method: 'POST',
        body: { title: 'Heater', body: mentioning(target) },
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: {
          code: 'forbidden',
          message:
            'You can only Mention people who can read this Thread. Remove the Mention and try again.',
        },
      });
      const list = await request(`/api/channels/${channel.id}/threads`);
      expect(((await list.json()) as ThreadPage).threads).toEqual([]);
    });
  });

  describe('editing a Thread', () => {
    it('Pings only the newly Mentioned, and leaves earlier Mentions alone', async () => {
      const earlier = await createStaffMember();
      const added = await createStaffMember();
      const member = await createStaffMember();
      const { channel, request } = await channelOf('public', member);
      const started = (await (
        await request(`/api/channels/${channel.id}/threads`, {
          method: 'POST',
          body: { title: 'Heater', body: mentioning(earlier) },
        })
      ).json()) as ThreadView;
      const path = `/api/channels/${channel.id}/threads/${started.id}`;

      const res = await request(path, {
        method: 'PATCH',
        body: { title: 'Heater', body: mentioning(earlier, added) },
      });
      expect(res.status).toBe(200);
      expect(await pingCountFor(added, started.id)).toBe(1);
      expect(await pingCountFor(earlier, started.id)).toBe(1);
      expect(await pingCountFor(member, started.id)).toBe(1);

      // Saving the same Mentions again Pings nobody.
      await request(path, {
        method: 'PATCH',
        body: { title: 'Heater', body: mentioning(earlier, added) },
      });
      expect(await pingCountFor(added, started.id)).toBe(1);
    });

    it('keeps an existing Mention of someone who has since been Deactivated', async () => {
      const later = await createStaffMember();
      const admin = await createStaffMember({ role: 'admin' });
      const { channel, request } = await channelOf('public');
      const started = (await (
        await request(`/api/channels/${channel.id}/threads`, {
          method: 'POST',
          body: { title: 'Heater', body: mentioning(later) },
        })
      ).json()) as ThreadView;
      await asOwner((query) =>
        query('update staff_member set deactivated_at = now(), deactivated_by = $2 where id = $1', [
          later.id,
          admin.id,
        ]),
      );
      const res = await request(`/api/channels/${channel.id}/threads/${started.id}`, {
        method: 'PATCH',
        body: { title: 'Heater, fixed', body: mentioning(later) },
      });
      expect(res.status).toBe(200);
    });

    it('shows a Mentioned person’s current name after they’re renamed', async () => {
      const renamed = await createStaffMember();
      const { channel, request } = await channelOf('public');
      const started = (await (
        await request(`/api/channels/${channel.id}/threads`, {
          method: 'POST',
          body: { title: 'Heater', body: mentioning(renamed) },
        })
      ).json()) as ThreadView;
      await asOwner((query) =>
        query(`update "user" set name = 'Laura Gómez-Puig' where id = $1`, [renamed.id]),
      );
      const view = (await (
        await request(`/api/channels/${channel.id}/threads/${started.id}`)
      ).json()) as ThreadView;
      expect(view.mentionNames).toEqual({ [renamed.id]: 'Laura Gómez-Puig' });
    });
  });

  describe('Thread Responses', () => {
    it('Pings a Mentioned person in a new Thread Response, and an edit that adds one', async () => {
      const first = await createStaffMember();
      const second = await createStaffMember();
      const { author, channel, request } = await channelOf('public');
      const thread = await insertThread({ channelId: channel.id, authorId: author.id });
      const responses = `/api/channels/${channel.id}/threads/${thread.id}/responses`;

      const sent = await request(responses, { method: 'POST', body: { body: mentioning(first) } });
      expect(sent.status).toBe(201);
      const view = (await sent.json()) as ThreadResponseView;
      expect(view.mentionNames).toEqual({ [first.id]: first.name });
      expect(await pingCountFor(first, thread.id)).toBe(1);

      const edited = await request(`${responses}/${view.id}`, {
        method: 'PATCH',
        body: { body: mentioning(first, second) },
      });
      expect(edited.status).toBe(200);
      expect(await pingCountFor(second, thread.id)).toBe(1);
      expect(await pingCountFor(first, thread.id)).toBe(1);
    });

    it('refuses a Mention of a non-member of a Private channel', async () => {
      const outsider = await createStaffMember();
      const { author, channel, request } = await channelOf('private');
      const thread = await insertThread({ channelId: channel.id, authorId: author.id });
      const res = await request(`/api/channels/${channel.id}/threads/${thread.id}/responses`, {
        method: 'POST',
        body: { body: mentioning(outsider) },
      });
      expect(res.status).toBe(403);
    });

    it('removes a deleted Thread Response’s Mentions', async () => {
      const mentioned = await createStaffMember();
      const { author, channel, request } = await channelOf('public', mentioned);
      const thread = await insertThread({ channelId: channel.id, authorId: author.id });
      const responses = `/api/channels/${channel.id}/threads/${thread.id}/responses`;
      const sent = (await (
        await request(responses, { method: 'POST', body: { body: mentioning(mentioned) } })
      ).json()) as ThreadResponseView;

      expect((await request(`${responses}/${sent.id}`, { method: 'DELETE' })).status).toBe(204);
      const list = (await (await request(responses)).json()) as ThreadResponseList;
      expect(list.responses[0]?.mentionNames).toEqual({});
      const rows = (await (
        await (
          await as(mentioned)
        )(`/api/channels/${channel.id}/threads`)
      ).json()) as ThreadPage;
      expect(rows.threads[0]?.mentionsYou).toBe(false);
    });
  });

  describe('"@You" on Thread rows', () => {
    it('marks Threads that Mention the viewer, in the Thread or a Thread Response', async () => {
      const viewer = await createStaffMember();
      const { author, channel, request } = await channelOf('public', viewer);
      const inThread = (await (
        await request(`/api/channels/${channel.id}/threads`, {
          method: 'POST',
          body: { title: 'In the Thread', body: mentioning(viewer) },
        })
      ).json()) as ThreadView;
      const inResponse = await insertThread({ channelId: channel.id, authorId: author.id });
      await request(`/api/channels/${channel.id}/threads/${inResponse.id}/responses`, {
        method: 'POST',
        body: { body: mentioning(viewer) },
      });
      const elsewhere = await insertThread({ channelId: channel.id, authorId: author.id });

      const page = (await (
        await (
          await as(viewer)
        )(`/api/channels/${channel.id}/threads?status=all`)
      ).json()) as ThreadPage;
      const marked = Object.fromEntries(page.threads.map((t) => [t.id, t.mentionsYou]));
      expect(marked).toEqual({
        [inThread.id]: true,
        [inResponse.id]: true,
        [elsewhere.id]: false,
      });
      // The author isn't Mentioned anywhere.
      const own = (await (
        await request(`/api/channels/${channel.id}/threads?status=all`)
      ).json()) as ThreadPage;
      expect(own.threads.every((t) => !t.mentionsYou)).toBe(true);
    });
  });
});
