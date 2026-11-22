// Pings: the shapes the server answers with and the query the Pings view takes
// (product.md › Pings, screens.md › Pings and Saved views).
import { z } from 'zod';
import type { ThreadRow } from './thread';

/** GET /api/pings. `after` is the last Thread of the page before, for Load more. */
export const listPingsQuery = z.object({
  after: z.uuid({ error: 'That isn’t a Thread.' }).optional(),
});

/** A Thread row in the Pings view: the same row as a Channel's feed, with the Channel's name. */
export type PingRow = ThreadRow & { channelName: string };

/** A page of the Staff member's Threads with a Ping, by latest Ping activity, newest first. */
export type PingPage = {
  threads: PingRow[];
  /** Pass as `after` to load the next page; null when this is the last. */
  nextCursor: string | null;
};

/**
 * How many Threads have a Ping for the viewer: in all (the Pings badge), and per Channel
 * (the bold count beside a Channel in the sidebar).
 */
export type PingSummary = {
  threadCount: number;
  channels: { channelId: string; count: number }[];
};

/** A Thread's open Ping for the viewer, as the Thread view shows it. */
export type ThreadPing = {
  /** What's new since they last Acknowledged. */
  count: number;
  /** When the first of it happened: Thread Responses from here on are new. */
  firstAt: string;
};
