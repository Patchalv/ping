import type { LiveEvent } from '@ping/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLiveHub, type LiveClient, type LiveFrame, type Receive } from './hub';

const CHANNEL_A = '00000000-0000-4000-8000-00000000000a';
const CHANNEL_B = '00000000-0000-4000-8000-00000000000b';
const STAFF = '00000000-0000-4000-8000-000000000001';

const created = (channelId: string): LiveEvent => ({ kind: 'channel.created', channelId });

/** A client that records what it was sent, deciding with `receive`. */
function recordingClient(receive: Receive = async () => 'deliver') {
  const frames: LiveFrame[] = [];
  const client: LiveClient & { frames: LiveFrame[]; heartbeats: number; closed: boolean } = {
    staffId: STAFF,
    frames,
    heartbeats: 0,
    closed: false,
    receive,
    send: (frame) => {
      frames.push(frame);
    },
    heartbeat() {
      client.heartbeats += 1;
    },
    close() {
      client.closed = true;
    },
  };
  return client;
}

const eventsOf = (frames: LiveFrame[]) =>
  frames.map((frame) => (frame.type === 'change' ? frame.event : 'resync'));

/** Lets every queued delivery run, well short of a heartbeat. */
const settle = () => vi.advanceTimersByTimeAsync(100);

describe('live hub', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends a published event to a connected client, with an ID', async () => {
    const hub = createLiveHub({ bootId: 'boot1' });
    const client = recordingClient();
    hub.connect(client);
    hub.publish(created(CHANNEL_A));
    await settle();
    expect(client.frames).toEqual([{ type: 'change', id: 'boot1:1', event: created(CHANNEL_A) }]);
  });

  it('sends nothing the client may not receive', async () => {
    const hub = createLiveHub({ bootId: 'boot1' });
    const client = recordingClient(async (event) =>
      'channelId' in event && event.channelId === CHANNEL_B ? 'skip' : 'deliver',
    );
    hub.connect(client);
    hub.publish(created(CHANNEL_B));
    hub.publish(created(CHANNEL_A));
    await settle();
    expect(eventsOf(client.frames)).toEqual([created(CHANNEL_A)]);
  });

  it('keeps each client’s events in order, however long each check takes', async () => {
    const hub = createLiveHub({ bootId: 'boot1' });
    // The first check is the slowest.
    let delay = 30;
    const client = recordingClient(async () => {
      delay -= 10;
      await new Promise((resolve) => setTimeout(resolve, delay));
      return 'deliver';
    });
    hub.connect(client);
    hub.publish(created(CHANNEL_A));
    hub.publish(created(CHANNEL_B));
    await settle();
    expect(eventsOf(client.frames)).toEqual([created(CHANNEL_A), created(CHANNEL_B)]);
  });

  it('closes and drops a client whose Staff member is gone (Deactivated)', async () => {
    const hub = createLiveHub({ bootId: 'boot1' });
    const client = recordingClient(async () => 'gone');
    hub.connect(client);
    hub.publish(created(CHANNEL_A));
    await settle();
    expect(client.closed).toBe(true);
    hub.publish(created(CHANNEL_B));
    await settle();
    expect(client.frames).toEqual([]);
  });

  it('sends nothing after a client disconnects', async () => {
    const hub = createLiveHub({ bootId: 'boot1' });
    const client = recordingClient();
    const disconnect = hub.connect(client);
    disconnect();
    hub.publish(created(CHANNEL_A));
    await settle();
    expect(client.frames).toEqual([]);
  });

  it('keeps delivering to others when one client’s check fails, and reports it', async () => {
    const reported: unknown[] = [];
    const hub = createLiveHub({ bootId: 'boot1', reportError: (error) => reported.push(error) });
    const failing = recordingClient(async () => {
      throw new Error('database unreachable');
    });
    const healthy = recordingClient();
    hub.connect(failing);
    hub.connect(healthy);
    hub.publish(created(CHANNEL_A));
    await settle();
    expect(eventsOf(healthy.frames)).toEqual([created(CHANNEL_A)]);
    expect(failing.closed).toBe(true);
    expect(reported).toHaveLength(1);
  });

  describe('resuming with Last-Event-ID', () => {
    it('replays what the client missed, checked again now', async () => {
      const hub = createLiveHub({ bootId: 'boot1' });
      hub.publish(created(CHANNEL_A));
      hub.publish(created(CHANNEL_B));
      hub.publish(created(CHANNEL_A));
      const client = recordingClient(async (event) =>
        'channelId' in event && event.channelId === CHANNEL_B ? 'skip' : 'deliver',
      );
      hub.connect(client, 'boot1:1');
      await settle();
      expect(client.frames).toEqual([{ type: 'change', id: 'boot1:3', event: created(CHANNEL_A) }]);
    });

    it('replays before anything published after it reconnects', async () => {
      const hub = createLiveHub({ bootId: 'boot1' });
      hub.publish(created(CHANNEL_A));
      const client = recordingClient();
      hub.connect(client, 'boot1:0');
      hub.publish(created(CHANNEL_B));
      await settle();
      expect(client.frames.map((frame) => frame.type === 'change' && frame.id)).toEqual([
        'boot1:1',
        'boot1:2',
      ]);
    });

    it('sends nothing to replay when the client is up to date', async () => {
      const hub = createLiveHub({ bootId: 'boot1' });
      hub.publish(created(CHANNEL_A));
      const client = recordingClient();
      hub.connect(client, 'boot1:1');
      await settle();
      expect(client.frames).toEqual([]);
    });

    it.each([
      ['fell further behind than the buffer holds', 'boot1:1'],
      ['comes from before a server restart', 'boot0:3'],
      ['is ahead of anything published', 'boot1:99'],
      ['is not an ID Ping sent', 'nonsense'],
    ])('tells the client to refetch everything when its ID %s', async (_case, lastEventId) => {
      const hub = createLiveHub({ bootId: 'boot1', bufferSize: 2 });
      hub.publish(created(CHANNEL_A));
      hub.publish(created(CHANNEL_B));
      hub.publish(created(CHANNEL_A));
      hub.publish(created(CHANNEL_B));
      const client = recordingClient();
      hub.connect(client, lastEventId);
      hub.publish(created(CHANNEL_A));
      await settle();
      expect(client.frames).toEqual([
        { type: 'resync' },
        { type: 'change', id: 'boot1:5', event: created(CHANNEL_A) },
      ]);
    });

    it('replays the whole buffer when the client missed exactly what it holds', async () => {
      const hub = createLiveHub({ bootId: 'boot1', bufferSize: 2 });
      hub.publish(created(CHANNEL_A));
      hub.publish(created(CHANNEL_B));
      hub.publish(created(CHANNEL_A));
      const client = recordingClient();
      hub.connect(client, 'boot1:1');
      await settle();
      expect(client.frames.map((frame) => frame.type === 'change' && frame.id)).toEqual([
        'boot1:2',
        'boot1:3',
      ]);
    });
  });

  it('sends every client a heartbeat every 25 seconds, without touching the checks', async () => {
    const receive = vi.fn<Receive>(async () => 'deliver');
    const hub = createLiveHub({ bootId: 'boot1' });
    const client = recordingClient(receive);
    hub.connect(client);
    await vi.advanceTimersByTimeAsync(24_999);
    expect(client.heartbeats).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(client.heartbeats).toBe(1);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(client.heartbeats).toBe(2);
    expect(receive).not.toHaveBeenCalled();
  });

  it('lets a test watch everything published', () => {
    const hub = createLiveHub({ bootId: 'boot1' });
    const seen: LiveEvent[] = [];
    const stop = hub.watch((event) => seen.push(event));
    hub.publish(created(CHANNEL_A));
    stop();
    hub.publish(created(CHANNEL_B));
    expect(seen).toEqual([created(CHANNEL_A)]);
  });
});
