// GET /api/live: each open browser's one Server-Sent Events stream (product.md › Live
// updates). Signing in and the actor check run in one short transaction that ends before
// the stream opens; no transaction stays open on it (permissions.md › Identity per request).
// Each event is then checked in its own short transaction as the receiving Staff member, so
// row-level security and the permissions module both decide, at the moment it's sent.
import { LIVE_CHANGE, LIVE_RESYNC, liveStreamHeaders } from '@ping/shared';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Auth } from '../../auth';
import { createWithActorTx, signedIn } from '../../auth/actor';
import { findActiveStaffRole } from '../../auth/queries';
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

    // Per event, as this Staff member: still active, and able to read the Channel.
    const receive: Receive = (event) =>
      database.withStaffTx(staffId, async (tx) => {
        const role = await findActiveStaffRole(tx, staffId);
        if (!role) return 'gone';
        const ctx = { tx, actor: { staffId, role } };
        const channel =
          'channelId' in event ? await findLiveChannelAccess(ctx, event.channelId) : undefined;
        return canReceiveLiveEvent(ctx.actor, event, channel).allow ? 'deliver' : 'skip';
      });

    return streamSSE(c, (stream) => {
      const send = async (frame: LiveFrame) => {
        if (stream.closed || stream.aborted) return;
        await (frame.type === 'change'
          ? stream.writeSSE({ id: frame.id, event: LIVE_CHANGE, data: JSON.stringify(frame.event) })
          : stream.writeSSE({ event: LIVE_RESYNC, data: '' }));
      };
      // The stream stays open until the browser goes, or the hub cuts it off.
      return new Promise<void>((resolve) => {
        const disconnect = liveHub.connect(
          {
            staffId,
            receive,
            send,
            heartbeat: async () => {
              if (!stream.closed && !stream.aborted) await stream.write(': heartbeat\n\n');
            },
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
