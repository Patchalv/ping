// Saved: the shapes the server answers with and the query the Saved view takes
// (product.md › Saved, screens.md › Pings and Saved views).
import { z } from 'zod';
import type { ThreadRow } from './thread';

/** GET /api/saved. `after` is the last Thread of the page before, for Load more. */
export const listSavedQuery = z.object({
  after: z.uuid({ error: 'That isn’t a Thread.' }).optional(),
});

/** A Thread row in the Saved view: the same row as a Channel's feed, with the Channel's name. */
type SavedRow = ThreadRow & { channelName: string };

/** A page of the Staff member's Saved Threads, by when each was saved, newest first. */
export type SavedPage = {
  threads: SavedRow[];
  /** Pass as `after` to load the next page; null when this is the last. */
  nextCursor: string | null;
};

/**
 * How many Threads the viewer has Saved, in all: the count on the home screen. A separate
 * answer because the Saved list pages at 50.
 */
export type SavedSummary = {
  count: number;
};
