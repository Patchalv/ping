// The Thread Response routes through the real app: what they answer, beyond the
// permission matrix's allow and deny statuses.
import { randomUUID } from 'node:crypto';
import type { ThreadResponseView } from '@ping/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asOwner,
  createStaffMember,
  insertChannel,
  insertThread,
  insertThreadResponse,
  type StaffFixture,
} from '../../db/test-support';
import { createTestApp, jsonHeaders, signIn, type TestApp } from '../../test/test-app';

const doc = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

const latestActivity = async (threadId: string) =>
  (
    await asOwner((query) =>
      query<{ at: Date }>('select latest_activity_at as at from thread where id = $1', [threadId]),
    )
  ).rows[0]?.at.toISOString();

const auditFor = async (channelId: string) =>
  (
    await asOwner((query) =>
      query<{ actor_id: string; kind: string; target_staff_id: string }>(
        `select actor_id, kind, target_staff_id from audit_event where channel_id = $1
          and kind like 'admin_%' order by created_at`,
        [channelId],
      ),
    )
  ).rows;

describe('Thread Response routes', () => {
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

  /** A Channel with a Thread, started an hour ago by its Channel admin, the author. */
  async function threadInNewChannel() {
    const author = await createStaffMember();
    const channel = await insertChannel({ members: [{ staffId: author.id, channelAdmin: true }] });
    const thread = await insertThread({
      channelId: channel.id,
      authorId: author.id,
      latestActivityAt: new Date(Date.now() - 60 * 60 * 1000),
    });
    const base = `/api/channels/${channel.id}/threads/${thread.id}/responses`;
    return { author, channel, thread, base, request: await as(author) };
  }

  describe('POST …/responses', () => {
    it('sends a Thread Response and moves the Thread’s Latest activity to it', async () => {
      const { author, thread, base, request } = await threadInNewChannel();
      const res = await request(base, { method: 'POST', body: { body: doc('On my way') } });
      expect(res.status).toBe(201);
      const sent = (await res.json()) as ThreadResponseView;
      expect(sent).toEqual({
        id: expect.any(String),
        threadId: thread.id,
        author: { staffId: author.id, name: author.name, isDeactivated: false },
        createdAt: expect.any(String),
        edited: null,
        body: doc('On my way'),
        isDeleted: false,
        reactions: [],
        canReact: true,
        canEdit: true,
        canDelete: true,
      });
      expect(await latestActivity(thread.id)).toBe(sent.createdAt);
      const stored = await asOwner((query) =>
        query<{ body_text: string }>('select body_text from thread_response where id = $1', [
          sent.id,
        ]),
      );
      expect(stored.rows[0]?.body_text).toBe('On my way');
    });

    it('refuses an empty Thread Response, saying what to do', async () => {
      const { base, request } = await threadInNewChannel();
      const res = await request(base, { method: 'POST', body: { body: doc('  ') } });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({
        error: {
          code: 'validation',
          message: 'Write something before sending.',
          issues: [{ path: 'body', message: 'Write something before sending.' }],
        },
      });
    });

    it('answers 404 for a Thread in another Channel, like a missing one', async () => {
      const { author, channel, request } = await threadInNewChannel();
      const elsewhere = await insertChannel({
        members: [{ staffId: author.id, channelAdmin: true }],
      });
      const other = await insertThread({ channelId: elsewhere.id, authorId: author.id });
      for (const threadId of [other.id, randomUUID()]) {
        const res = await request(`/api/channels/${channel.id}/threads/${threadId}/responses`, {
          method: 'POST',
          body: { body: doc('Hi') },
        });
        expect(res.status).toBe(404);
      }
    });
  });

  describe('PATCH …/responses/:threadResponseId', () => {
    it('lets the author edit, marking it "edited" without moving Latest activity', async () => {
      const { author, channel, thread, base, request } = await threadInNewChannel();
      const response = await insertThreadResponse({
        threadId: thread.id,
        channelId: channel.id,
        authorId: author.id,
      });
      const before = await latestActivity(thread.id);
      const res = await request(`${base}/${response.id}`, {
        method: 'PATCH',
        body: { body: doc('Fixed now') },
      });
      expect(res.status).toBe(200);
      const edited = (await res.json()) as ThreadResponseView;
      expect(edited.body).toEqual(doc('Fixed now'));
      expect(edited.edited).toEqual({ at: expect.any(String), by: null });
      expect(await latestActivity(thread.id)).toBe(before);
      expect(await auditFor(channel.id)).toEqual([]);
    });

    it('marks a company Admin’s edit "edited by <name>", and audits it', async () => {
      const { author, channel, thread, base } = await threadInNewChannel();
      const admin = await createStaffMember({ role: 'admin' });
      const response = await insertThreadResponse({
        threadId: thread.id,
        channelId: channel.id,
        authorId: author.id,
      });
      const res = await (await as(admin))(`${base}/${response.id}`, {
        method: 'PATCH',
        body: { body: doc('Tidied') },
      });
      expect(res.status).toBe(200);
      const edited = (await res.json()) as ThreadResponseView;
      expect(edited.edited?.by).toEqual({ staffId: admin.id, name: admin.name });
      expect(await auditFor(channel.id)).toEqual([
        { actor_id: admin.id, kind: 'admin_edited_thread_response', target_staff_id: author.id },
      ]);
    });

    it('doesn’t audit a company Admin editing their own Thread Response', async () => {
      const admin = await createStaffMember({ role: 'admin' });
      const channel = await insertChannel({ members: [{ staffId: admin.id, channelAdmin: true }] });
      const thread = await insertThread({ channelId: channel.id, authorId: admin.id });
      const response = await insertThreadResponse({
        threadId: thread.id,
        channelId: channel.id,
        authorId: admin.id,
      });
      const res = await (await as(admin))(
        `/api/channels/${channel.id}/threads/${thread.id}/responses/${response.id}`,
        { method: 'PATCH', body: { body: doc('Mine') } },
      );
      expect(res.status).toBe(200);
      expect(((await res.json()) as ThreadResponseView).edited?.by).toBeNull();
      expect(await auditFor(channel.id)).toEqual([]);
    });

    it('answers 404 for a Thread Response in another Thread', async () => {
      const { author, channel, base, request } = await threadInNewChannel();
      const other = await insertThread({ channelId: channel.id, authorId: author.id });
      const response = await insertThreadResponse({
        threadId: other.id,
        channelId: channel.id,
        authorId: author.id,
      });
      const res = await request(`${base}/${response.id}`, {
        method: 'PATCH',
        body: { body: doc('Hi') },
      });
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE …/responses/:threadResponseId', () => {
    it('leaves the "Thread Response deleted" placeholder, without moving Latest activity', async () => {
      const { author, channel, thread, base, request } = await threadInNewChannel();
      const response = await insertThreadResponse({
        threadId: thread.id,
        channelId: channel.id,
        authorId: author.id,
      });
      const before = await latestActivity(thread.id);
      expect((await request(`${base}/${response.id}`, { method: 'DELETE' })).status).toBe(204);
      const stored = await asOwner((query) =>
        query<{ body: unknown; body_text: string | null; deleted_by: string; search: string }>(
          `select body, body_text, deleted_by, search::text from thread_response where id = $1`,
          [response.id],
        ),
      );
      expect(stored.rows[0]).toEqual({
        body: null,
        body_text: null,
        deleted_by: author.id,
        search: '',
      });
      expect(await latestActivity(thread.id)).toBe(before);
    });

    it('answers 404 to editing or deleting one already deleted', async () => {
      const { author, channel, thread, base, request } = await threadInNewChannel();
      const response = await insertThreadResponse({
        threadId: thread.id,
        channelId: channel.id,
        authorId: author.id,
      });
      await request(`${base}/${response.id}`, { method: 'DELETE' });
      expect((await request(`${base}/${response.id}`, { method: 'DELETE' })).status).toBe(404);
      const edit = await request(`${base}/${response.id}`, {
        method: 'PATCH',
        body: { body: doc('Back') },
      });
      expect(edit.status).toBe(404);
    });

    it('audits a company Admin deleting someone else’s', async () => {
      const { author, channel, thread, base } = await threadInNewChannel();
      const admin = await createStaffMember({ role: 'admin' });
      const response = await insertThreadResponse({
        threadId: thread.id,
        channelId: channel.id,
        authorId: author.id,
      });
      const res = await (await as(admin))(`${base}/${response.id}`, { method: 'DELETE' });
      expect(res.status).toBe(204);
      expect(await auditFor(channel.id)).toEqual([
        { actor_id: admin.id, kind: 'admin_deleted_thread_response', target_staff_id: author.id },
      ]);
    });
  });
});
