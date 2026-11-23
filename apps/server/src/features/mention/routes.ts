// The Mention routes, mounted at /api/channels/:channelId/mention-candidates. Each follows
// the exemplar (features/channel/routes.ts): signedIn, validate(), all the work in
// withActorTx with a require… helper inside it. Saving a Mention happens with its post, in
// the Thread and Thread Response routes.
import { channelParams, type MentionCandidateList } from '@ping/shared';
import { Hono } from 'hono';
import type { Auth } from '../../auth';
import { createWithActorTx, signedIn } from '../../auth/actor';
import type { Database } from '../../db';
import { NotFoundError } from '../../lib/errors';
import { validate } from '../../lib/validate';
import { requireCanListMentionCandidates } from '../../permissions/mention';
import { findMentionChannel, listMentionCandidates } from './queries';

export function mentionRoutes({ auth, database }: { auth: Auth; database: Database }) {
  const withActorTx = createWithActorTx(database);

  // The @ picker's list: the Staff members who can read the Channel's Threads.
  return new Hono().get('/', signedIn(auth), validate('param', channelParams), async (c) => {
    const { channelId } = c.req.valid('param');
    const list = await withActorTx(c, async (ctx): Promise<MentionCandidateList> => {
      const found = await findMentionChannel(ctx, channelId);
      if (!found) throw new NotFoundError();
      requireCanListMentionCandidates(ctx.actor, found);
      return { candidates: await listMentionCandidates(ctx, channelId, found.visibility) };
    });
    return c.json(list);
  });
}
