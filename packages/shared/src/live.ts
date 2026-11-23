// Live updates (product.md › Live updates): what the server pushes down each browser's one
// Server-Sent Events stream, GET /api/live. An event carries a kind and IDs, never content.
// The SPA refetches what changed through the ordinary API, where the permissions module and
// row-level security decide what it may see.
import { z } from 'zod';

const id = z.uuid();

/** The kinds of change, with the IDs each carries. */
export const liveEvent = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('channel.created'), channelId: id }),
  // Someone joined, left, was added or removed, or became or stopped being Channel admin;
  // or a Deactivation changed the Channel.
  z.object({ kind: z.literal('channel.changed'), channelId: id }),
  // The Staff member left a Channel or was removed from one. Only they hear it, and it
  // names no Channel, since they may no longer read it: their sidebar and screens refetch.
  z.object({ kind: z.literal('membership.changed'), staffId: id }),
  z.object({ kind: z.literal('thread.created'), channelId: id, threadId: id }),
  // A Thread was edited, or someone reacted to it or took a reaction back.
  z.object({ kind: z.literal('thread.changed'), channelId: id, threadId: id }),
  z.object({ kind: z.literal('thread.deleted'), channelId: id, threadId: id }),
  z.object({
    kind: z.literal('thread_response.created'),
    channelId: id,
    threadId: id,
    threadResponseId: id,
  }),
  // A Thread Response was edited or deleted (it stays as its placeholder), or someone
  // reacted to it or took a reaction back.
  z.object({
    kind: z.literal('thread_response.changed'),
    channelId: id,
    threadId: id,
    threadResponseId: id,
  }),
  // Someone's Pings changed: new activity Pinged people, or someone Acknowledged. Leaving
  // or being removed from a Private channel drops Pings, with no one Thread.
  z.object({ kind: z.literal('ping.changed'), channelId: id, threadId: id.optional() }),
  // Someone was invited, re-invited, had their invite cancelled, changed their name, email
  // or role, or was Deactivated or reactivated.
  z.object({ kind: z.literal('staff.changed'), staffId: id }),
]);

export type LiveEvent = z.infer<typeof liveEvent>;

/** The SSE event name of a change. Its data is one LiveEvent as JSON. */
export const LIVE_CHANGE = 'change';

/**
 * The SSE event name telling a client it missed events it can't replay (it fell too far
 * behind, or the server restarted): it refetches everything it shows.
 */
export const LIVE_RESYNC = 'resync';

/**
 * GET /api/live's headers. A browser's EventSource sends `Last-Event-ID` when it
 * reconnects, so the server can replay what it missed.
 */
export const liveStreamHeaders = z.object({
  'last-event-id': z.string().max(200).optional(),
});
