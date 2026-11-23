// GET /api/live through the real app: who receives which events, resuming with
// Last-Event-ID, and losing access. From "Live updates over SSE" (#47).
//
// Absence is proven in order: each test publishes the event that must not arrive, then a
// sentinel the Staff member can receive, and reads until the sentinel. Each stream's
// events keep their order, so an event that didn't arrive before it never will.
import type { LiveEvent } from '@ping/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  asOwner,
  createStaffMember,
  insertChannel,
  type StaffFixture,
} from '../../db/test-support';
import { createTestApp, jsonHeaders, signIn, type TestApp } from '../../test/test-app';
import { publish } from './publish';

type Frame = { event: string; id?: string; data: string };

/** An open stream, read frame by frame. */
type Stream = {
  status: number;
  /** Reads frames until one matches, and returns every frame read on the way. */
  readUntil(match: (frame: Frame) => boolean): Promise<Frame[]>;
  /** Resolves when the server closes the stream. */
  ended(): Promise<void>;
  close(): Promise<void>;
};

const TIMEOUT_MS = 5000;

function parseFrame(raw: string): Frame | undefined {
  const frame: Frame = { event: 'message', data: '' };
  let hasField = false;
  for (const line of raw.split('\n')) {
    if (line.startsWith(':') || line === '') continue;
    const [field, ...rest] = line.split(':');
    const value = rest.join(':').replace(/^ /, '');
    hasField = true;
    if (field === 'event') frame.event = value;
    else if (field === 'id') frame.id = value;
    else if (field === 'data') frame.data += value;
  }
  return hasField ? frame : undefined;
}

function changeOf(frame: Frame): LiveEvent | undefined {
  return frame.event === 'change' ? (JSON.parse(frame.data) as LiveEvent) : undefined;
}

/** The Channel a change is about, if any. */
function channelOf(frame: Frame): string | undefined {
  const event = changeOf(frame);
  return event && 'channelId' in event ? event.channelId : undefined;
}

describe('GET /api/live', () => {
  let testApp: TestApp;
  const open: Stream[] = [];
  beforeAll(() => {
    testApp = createTestApp();
  });
  afterAll(async () => {
    await Promise.all(open.map((stream) => stream.close()));
    await testApp.close();
  });

  async function openStream(
    staff: StaffFixture | null,
    headers: Record<string, string> = {},
  ): Promise<Stream> {
    const cookie = staff ? await signIn(testApp, staff) : undefined;
    const res = await testApp.app.request('/api/live', {
      headers: jsonHeaders({ ...(cookie ? { cookie } : {}), ...headers }),
    });
    const reader = res.body?.getReader();
    const decoder = new TextDecoder();
    let text = '';
    let done = false;
    const pending: Frame[] = [];

    async function pull(): Promise<void> {
      if (!reader) throw new Error('No body');
      const chunk = await reader.read();
      if (chunk.done) {
        done = true;
        return;
      }
      text += decoder.decode(chunk.value, { stream: true });
      const parts = text.split('\n\n');
      text = parts.pop() ?? '';
      for (const part of parts) {
        const frame = parseFrame(part);
        if (frame) pending.push(frame);
      }
    }

    async function withTimeout<T>(work: Promise<T>): Promise<T> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Timed out reading the stream')), TIMEOUT_MS);
      });
      try {
        return await Promise.race([work, timeout]);
      } finally {
        clearTimeout(timer);
      }
    }

    const stream: Stream = {
      status: res.status,
      readUntil: (match) =>
        withTimeout(
          (async () => {
            const read: Frame[] = [];
            for (;;) {
              const frame = pending.shift();
              if (frame) {
                read.push(frame);
                if (match(frame)) return read;
              } else if (done) {
                throw new Error('The stream ended first');
              } else {
                await pull();
              }
            }
          })(),
        ),
      ended: () =>
        withTimeout(
          (async () => {
            while (!done) await pull();
          })(),
        ),
      close: async () => {
        await reader?.cancel().catch(() => undefined);
      },
    };
    open.push(stream);
    return stream;
  }

  /** A Public channel event everyone receives, to read up to. */
  async function sentinel() {
    const channel = await insertChannel({ visibility: 'public' });
    const event: LiveEvent = { kind: 'channel.created', channelId: channel.id };
    return {
      publish: () => publish(event),
      is: (frame: Frame) => channelOf(frame) === channel.id,
    };
  }

  /** The events about `channelId` that `stream` received before the sentinel. */
  async function receivedAbout(stream: Stream, channelId: string, mark: { is(f: Frame): boolean }) {
    const frames = await stream.readUntil(mark.is);
    return frames
      .map(changeOf)
      .filter((event) => event && 'channelId' in event && event.channelId === channelId);
  }

  const threadEvent = (channelId: string): LiveEvent => ({
    kind: 'thread.created',
    channelId,
    threadId: crypto.randomUUID(),
  });

  it('answers 401 with no session', async () => {
    const stream = await openStream(null);
    expect(stream.status).toBe(401);
  });

  it('streams Server-Sent Events, with only a kind and IDs in each', async () => {
    const staff = await createStaffMember();
    const channel = await insertChannel({ members: [{ staffId: staff.id, channelAdmin: true }] });
    const stream = await openStream(staff);
    expect(stream.status).toBe(200);
    const event = threadEvent(channel.id);
    publish(event);
    const frames = await stream.readUntil((frame) => channelOf(frame) === channel.id);
    const last = frames.at(-1);
    expect(last?.id).toMatch(/^.+:\d+$/);
    expect(JSON.parse(last?.data ?? '')).toEqual(event);
  });

  it('delivers a change made through an ordinary request', async () => {
    const [joiner, watcher] = await Promise.all([createStaffMember(), createStaffMember()]);
    const channel = await insertChannel({ members: [{ staffId: watcher.id, channelAdmin: true }] });
    const stream = await openStream(watcher);
    const res = await testApp.app.request(`/api/channels/${channel.id}/join`, {
      method: 'POST',
      headers: jsonHeaders({ cookie: await signIn(testApp, joiner) }),
    });
    expect(res.status).toBe(200);
    const frames = await stream.readUntil((frame) => channelOf(frame) === channel.id);
    expect(changeOf(frames.at(-1) as Frame)).toEqual({
      kind: 'channel.changed',
      channelId: channel.id,
    });
  });

  it('sends a Private channel’s events to its members', async () => {
    const member = await createStaffMember();
    const channel = await insertChannel({
      visibility: 'private',
      members: [{ staffId: member.id, channelAdmin: true }],
    });
    const mark = await sentinel();
    const stream = await openStream(member);
    const event = threadEvent(channel.id);
    publish(event);
    mark.publish();
    expect(await receivedAbout(stream, channel.id, mark)).toEqual([event]);
  });

  it.each([
    ['a Member', 'member'],
    ['a company Admin', 'admin'],
  ] as const)(
    'never sends a Private channel’s events to %s who isn’t in it',
    async (_who, role) => {
      const [outsider, insider] = await Promise.all([
        createStaffMember({ role }),
        createStaffMember(),
      ]);
      const channel = await insertChannel({
        visibility: 'private',
        members: [{ staffId: insider.id, channelAdmin: true }],
      });
      const mark = await sentinel();
      const stream = await openStream(outsider);
      for (const event of [
        { kind: 'channel.changed', channelId: channel.id },
        threadEvent(channel.id),
        { kind: 'ping.changed', channelId: channel.id },
      ] satisfies LiveEvent[]) {
        publish(event);
      }
      mark.publish();
      expect(await receivedAbout(stream, channel.id, mark)).toEqual([]);
    },
  );

  it('stops a Private channel’s events at once for someone removed from it', async () => {
    const [admin, removed] = await Promise.all([createStaffMember(), createStaffMember()]);
    const channel = await insertChannel({
      visibility: 'private',
      members: [{ staffId: admin.id, channelAdmin: true }, { staffId: removed.id }],
    });
    const stream = await openStream(removed);
    const res = await testApp.app.request(`/api/channels/${channel.id}/members/${removed.id}`, {
      method: 'DELETE',
      headers: jsonHeaders({ cookie: await signIn(testApp, admin) }),
    });
    expect(res.status).toBe(204);
    const mark = await sentinel();
    publish(threadEvent(channel.id));
    mark.publish();
    // Only the news that they were removed, so their sidebar drops the Channel.
    expect(await receivedAbout(stream, channel.id, mark)).toEqual([
      { kind: 'channel.changed', channelId: channel.id, staffId: removed.id },
    ]);
  });

  it('stops a Private channel’s events at once for someone who leaves it', async () => {
    const [admin, leaver] = await Promise.all([createStaffMember(), createStaffMember()]);
    const channel = await insertChannel({
      visibility: 'private',
      members: [{ staffId: admin.id, channelAdmin: true }, { staffId: leaver.id }],
    });
    const stream = await openStream(leaver);
    const res = await testApp.app.request(`/api/channels/${channel.id}/leave`, {
      method: 'POST',
      headers: jsonHeaders({ cookie: await signIn(testApp, leaver) }),
    });
    expect(res.status).toBe(204);
    const mark = await sentinel();
    publish(threadEvent(channel.id));
    mark.publish();
    expect(await receivedAbout(stream, channel.id, mark)).toEqual([
      { kind: 'channel.changed', channelId: channel.id, staffId: leaver.id },
    ]);
  });

  it('stops a Channel’s events at once for non-members when it turns Private', async () => {
    const [outsider, insider] = await Promise.all([createStaffMember(), createStaffMember()]);
    const channel = await insertChannel({ members: [{ staffId: insider.id, channelAdmin: true }] });
    const stream = await openStream(outsider);
    const before = threadEvent(channel.id);
    publish(before);
    await stream.readUntil((frame) => channelOf(frame) === channel.id);
    await asOwner((query) =>
      query(`update channel set visibility = 'private' where id = $1`, [channel.id]),
    );
    const mark = await sentinel();
    publish(threadEvent(channel.id));
    mark.publish();
    expect(await receivedAbout(stream, channel.id, mark)).toEqual([]);
  });

  it('sends changes to Staff members to everyone', async () => {
    const [watcher, changed] = await Promise.all([createStaffMember(), createStaffMember()]);
    const stream = await openStream(watcher);
    publish({ kind: 'staff.changed', staffId: changed.id });
    const frames = await stream.readUntil((frame) => {
      const event = changeOf(frame);
      return event?.kind === 'staff.changed' && event.staffId === changed.id;
    });
    expect(frames.length).toBeGreaterThan(0);
  });

  it('closes the stream of a Staff member Deactivated while it was open', async () => {
    const staff = await createStaffMember();
    const deactivator = await createStaffMember({ role: 'admin' });
    const stream = await openStream(staff);
    await asOwner((query) =>
      query('update staff_member set deactivated_at = now(), deactivated_by = $2 where id = $1', [
        staff.id,
        deactivator.id,
      ]),
    );
    publish({ kind: 'staff.changed', staffId: staff.id });
    await stream.ended();
  });

  describe('resuming with Last-Event-ID', () => {
    it('replays what was missed that the Staff member may read, and nothing else', async () => {
      const [staff, insider] = await Promise.all([createStaffMember(), createStaffMember()]);
      const readable = await insertChannel({ members: [{ staffId: staff.id }] });
      const hidden = await insertChannel({
        visibility: 'private',
        members: [{ staffId: insider.id, channelAdmin: true }],
      });
      const first = await openStream(staff);
      publish(threadEvent(readable.id));
      const seen = await first.readUntil((frame) => channelOf(frame) === readable.id);
      const lastEventId = seen.at(-1)?.id ?? '';
      await first.close();

      const missed = threadEvent(readable.id);
      publish(threadEvent(hidden.id));
      publish(missed);
      const mark = await sentinel();
      mark.publish();

      const resumed = await openStream(staff, { 'last-event-id': lastEventId });
      const frames = await resumed.readUntil(mark.is);
      const events = frames.map(changeOf);
      expect(events).toContainEqual(missed);
      expect(
        events.some((event) => event && 'channelId' in event && event.channelId === hidden.id),
      ).toBe(false);
    });

    it('tells a client it can’t catch up to refetch everything', async () => {
      const staff = await createStaffMember();
      const stream = await openStream(staff, { 'last-event-id': 'an-earlier-server:12' });
      const frames = await stream.readUntil((frame) => frame.event === 'resync');
      expect(frames.at(-1)).toEqual({ event: 'resync', data: '' });
    });
  });
});
