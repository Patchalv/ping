// GET /api/live: each open browser's one Server-Sent Events stream (product.md › Live
// updates). Signing in and the actor check run in one short transaction that ends before
// the stream opens; no transaction stays open on it (permissions.md › Identity per request).
// Each event is then checked in its own short transaction as the receiving Staff member, so
// row-level security and the permissions module both decide, at the moment it's sent.
import { LIVE_CHANGE, LIVE_RESYNC, liveStreamHeaders } from '@ping/shared';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Auth } from '../../auth';
import { createWithActorTx, findActor, signedIn } from '../../auth/actor';
import type { Database } from '../../db';
import { canReceiveLiveEvent, requireCanOpenLiveStream } from '../../permissions/live';
import { validate } from '../validate';
import type { LiveFrame, Receive } from './hub';
import { liveHub } from './publish';
import { findLiveChannelAccess } from './queries';

export function liveRoutes({ auth, database }: { auth: Auth; database: Database }) {
  const withActorTx = createWithActorTx(database);

  return new Hono().get('/', signedIn(auth), validate('header', liveStreamHeaders), async (c) => {
    const lastEventId = c.req.valid('header')['last-event-id'];
    const staffId = await withActorTx(c, async (ctx) => {
      requireCanOpenLiveStream(ctx.actor);
      return ctx.actor.staffId;
    });

    // Per event, as this Staff member, in a short transaction of its own (the one exception
    // to "one withActorTx per route": the stream outlives the request's): still active, and
    // able to read the Channel.
    const receive: Receive = (event) =>
      database.withStaffTx(staffId, async (tx) => {
        const actor = await findActor(tx, staffId);
        if (!actor) return 'gone';
        const channel =
          'channelId' in event
            ? await findLiveChannelAccess({ tx, actor }, event.channelId)
            : undefined;
        return canReceiveLiveEvent(actor, event, channel).allow ? 'deliver' : 'skip';
      });

    return streamSSE(c, (stream) => {
      const open = () => !stream.closed && !stream.aborted;
      // A write to a socket the browser just dropped fails before onAbort fires: that's a
      // normal disconnect, not an error to report.
      const write = async (text: () => Promise<void>) => {
        try {
          if (open()) await text();
        } catch (error) {
          if (open()) throw error;
        }
      };
      const send = (frame: LiveFrame) =>
        write(() =>
          frame.type === 'change'
            ? stream.writeSSE({
                id: frame.id,
                event: LIVE_CHANGE,
                data: JSON.stringify(frame.event),
              })
            : frame.type === 'resync'
              ? stream.writeSSE({ id: frame.id, event: LIVE_RESYNC, data: '' })
              : // No data: the browser records the ID and dispatches nothing.
                stream.writeSSE({ id: frame.id, data: '' }),
        );
      // The stream stays open until the browser goes, or the hub cuts it off.
      return new Promise<void>((resolve) => {
        const disconnect = liveHub.connect(
          {
            receive,
            send,
            heartbeat: () =>
              write(async () => {
                await stream.write(': heartbeat\n\n');
              }),
            close: resolve,
          },
          lastEventId,
        );
        stream.onAbort(() => {
          disconnect();
          resolve();
        });
      });
    });
  });
}
