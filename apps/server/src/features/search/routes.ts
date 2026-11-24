// The search routes, mounted at /api/search. Each follows the exemplar
// (features/channel/routes.ts): signedIn, validate(), all the work in withActorTx with a
// require… helper inside it. They only read, so nothing is published.
//
// Text with nothing searchable left (only stop words or punctuation) finds nothing, without
// asking the database.
import { searchChannelsQuery, searchThreadsQuery } from '@ping/shared';
import { Hono } from 'hono';
import type { Auth } from '../../auth';
import { createWithActorTx, signedIn } from '../../auth/actor';
import type { Database } from '../../db';
import { NotFoundError } from '../../lib/errors';
import { validate } from '../../lib/validate';
import { requireCanSearch, requireCanSearchInChannel } from '../../permissions/search';
import { findSearchChannel, listSearchPeople, searchChannels, searchThreads } from './queries';
import { toPrefixTsquery } from './search-terms';

type Options = { auth: Auth; database: Database };

export function searchRoutes({ auth, database }: Options) {
  const withActorTx = createWithActorTx(database);

  return (
    new Hono()
      // Channels whose name or description match. The chips narrow Threads only.
      .get('/channels', signedIn(auth), validate('query', searchChannelsQuery), async (c) => {
        const { q } = c.req.valid('query');
        const query = toPrefixTsquery(q);
        const channels = await withActorTx(c, async (ctx) => {
          requireCanSearch(ctx.actor);
          return query ? searchChannels(ctx, query) : [];
        });
        return c.json({ channels });
      })

      // Threads that match, one result each, narrowed by In, From and Status.
      .get('/threads', signedIn(auth), validate('query', searchThreadsQuery), async (c) => {
        const { q, ...chips } = c.req.valid('query');
        const query = toPrefixTsquery(q);
        const page = await withActorTx(c, async (ctx) => {
          requireCanSearch(ctx.actor);
          if (chips.in) {
            const access = await findSearchChannel(ctx, chips.in);
            if (!access) throw new NotFoundError();
            requireCanSearchInChannel(ctx.actor, access);
          }
          return query ? searchThreads(ctx, { query, ...chips }) : null;
        });
        return c.json(page ?? { threads: [], nextCursor: null });
      })

      // The people the From chip offers.
      .get('/people', signedIn(auth), async (c) => {
        const people = await withActorTx(c, (ctx) => {
          requireCanSearch(ctx.actor);
          return listSearchPeople(ctx);
        });
        return c.json({ people });
      })
  );
}
