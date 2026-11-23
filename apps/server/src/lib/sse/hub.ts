// The live-update hub: fans published events out, in memory, to every open stream. Ping
// runs exactly one app instance (platform.md › Consequences to respect), so there is no
// database table and no LISTEN, and Neon can sleep while streams sit idle.
//
// Each client decides, per event, whether its Staff member may receive it (`receive`, a
// short transaction of its own), so the hub knows nothing about permissions or the
// database. Each client's events go through its own queue, so they arrive in order however
// long each check takes.
import { randomUUID } from 'node:crypto';
import type { LiveEvent } from '@ping/shared';

/** What a client's Staff member may do with an event: get it, not get it, or (Deactivated) be cut off. */
export type Receive = (event: LiveEvent) => Promise<'deliver' | 'skip' | 'gone'>;

/** One frame down a stream: a change with its ID, or a resync (refetch everything). */
export type LiveFrame = { type: 'change'; id: string; event: LiveEvent } | { type: 'resync' };

/** One open stream. */
export type LiveClient = {
  staffId: string;
  receive: Receive;
  send(frame: LiveFrame): Promise<void> | void;
  heartbeat(): Promise<void> | void;
  close(): void;
};

/** Every 25 seconds: inside the 20–30 seconds product.md asks for. */
const HEARTBEAT_MS = 25_000;

/** How many recent events a reconnecting client can catch up on. */
const BUFFER_SIZE = 1000;

type Entry = { seq: number; event: LiveEvent };

type Connection = { client: LiveClient; queue: Promise<void>; open: boolean };

export function createLiveHub(
  options: {
    /** Tells this boot's event IDs apart from the last's, so a restart can't be mistaken for "nothing missed". */
    bootId?: string;
    bufferSize?: number;
    /** Sentry, for a check or a write that failed. */
    reportError?: (error: unknown) => void;
  } = {},
) {
  const bootId = options.bootId ?? randomUUID();
  const bufferSize = options.bufferSize ?? BUFFER_SIZE;
  const reportError = options.reportError ?? (() => undefined);
  const connections = new Set<Connection>();
  const watchers = new Set<(event: LiveEvent) => void>();
  const buffer: Entry[] = [];
  let seq = 0;
  let heartbeat: ReturnType<typeof setInterval> | undefined;

  const idOf = (entry: Entry) => `${bootId}:${entry.seq}`;

  function drop(connection: Connection) {
    connection.open = false;
    connections.delete(connection);
    if (connections.size === 0 && heartbeat) {
      clearInterval(heartbeat);
      heartbeat = undefined;
    }
  }

  /** Runs `step` after everything already queued for this client, never throwing. */
  function enqueue(connection: Connection, step: () => Promise<void> | void) {
    connection.queue = connection.queue.then(async () => {
      if (!connection.open) return;
      try {
        await step();
      } catch (error) {
        reportError(error);
        drop(connection);
        connection.client.close();
      }
    });
  }

  function deliver(connection: Connection, entry: Entry) {
    enqueue(connection, async () => {
      const decision = await connection.client.receive(entry.event);
      if (!connection.open) return;
      if (decision === 'gone') {
        drop(connection);
        connection.client.close();
      } else if (decision === 'deliver') {
        await connection.client.send({ type: 'change', id: idOf(entry), event: entry.event });
      }
    });
  }

  /** The buffered events after `lastEventId`, or undefined when they can't be replayed. */
  function missedSince(lastEventId: string): Entry[] | undefined {
    const match = /^(.+):(\d+)$/.exec(lastEventId);
    if (!match || match[1] !== bootId) return undefined;
    const last = Number(match[2]);
    const oldest = buffer[0]?.seq ?? seq + 1;
    if (last > seq || last + 1 < oldest) return undefined;
    return buffer.filter((entry) => entry.seq > last);
  }

  return {
    /** Sends an event to every client that may receive it. Never throws and never waits. */
    publish(event: LiveEvent): void {
      seq += 1;
      const entry = { seq, event };
      buffer.push(entry);
      if (buffer.length > bufferSize) buffer.shift();
      for (const watcher of watchers) watcher(event);
      for (const connection of connections) deliver(connection, entry);
    },

    /**
     * Opens a client's stream. With `lastEventId` (a reconnect), it first replays what the
     * client missed, or tells it to resync when that can't be replayed. Returns disconnect.
     */
    connect(client: LiveClient, lastEventId?: string): () => void {
      const connection: Connection = { client, queue: Promise.resolve(), open: true };
      // Registered and replayed in one synchronous step, so nothing published meanwhile is
      // lost or sent twice.
      connections.add(connection);
      if (lastEventId !== undefined) {
        const missed = missedSince(lastEventId);
        if (missed) for (const entry of missed) deliver(connection, entry);
        else enqueue(connection, () => client.send({ type: 'resync' }));
      }
      heartbeat ??= setInterval(() => {
        for (const open of connections) enqueue(open, () => open.client.heartbeat());
      }, HEARTBEAT_MS);
      heartbeat.unref?.();
      return () => drop(connection);
    },

    /** Calls `watcher` with every published event: the publish-coverage check. Returns stop. */
    watch(watcher: (event: LiveEvent) => void): () => void {
      watchers.add(watcher);
      return () => watchers.delete(watcher);
    },
  };
}
