// The Section routes. Each follows the exemplar (features/channel/routes.ts): signedIn,
// validate(), all the work in withActorTx with a require… helper inside it, then publish()
// after a change commits.
//
// - sectionRoutes, mounted at /api/sections: the Staff member's own Sections. Row-level
//   security keeps everyone to their own, so another Staff member's Section answers 404.
// - placementRoutes, mounted at /api/channels/:channelId/section: move a Channel between
//   Sections, which takes membership.
import {
  channelParams,
  createSectionBody,
  placeChannelBody,
  reorderSectionsBody,
  sectionParams,
  updateSectionBody,
} from '@ping/shared';
import { Hono } from 'hono';
import type { Auth } from '../../auth';
import { createWithActorTx, signedIn } from '../../auth/actor';
import type { Database } from '../../db';
import { ConflictError, NotFoundError } from '../../lib/errors';
import { publish } from '../../lib/sse/publish';
import { validate } from '../../lib/validate';
import { requireCanManageOwnSections, requireCanPlaceChannel } from '../../permissions/section';
import {
  createSection,
  deleteSection,
  findPlacementChannel,
  findSection,
  isOwnSection,
  listSectionIds,
  listSections,
  placeChannel,
  setSectionOrder,
  unplaceChannel,
  updateSection,
} from './queries';

type Options = { auth: Auth; database: Database };

const SECTIONS_CHANGED_MESSAGE =
  'Your Sections changed in another window. Refresh, then try again.';

/** The Staff member's own Sections. */
export function sectionRoutes({ auth, database }: Options) {
  const withActorTx = createWithActorTx(database);

  return (
    new Hono()
      // The sidebar's Sections, in order, each with its Channels.
      .get('/', signedIn(auth), async (c) => {
        const sections = await withActorTx(c, async (ctx) => {
          requireCanManageOwnSections(ctx.actor);
          return listSections(ctx);
        });
        return c.json(sections);
      })

      // + New section, below the others.
      .post('/', signedIn(auth), validate('json', createSectionBody), async (c) => {
        const { name } = c.req.valid('json');
        const { staffId, created } = await withActorTx(c, async (ctx) => {
          requireCanManageOwnSections(ctx.actor);
          const id = await createSection(ctx, name);
          return { staffId: ctx.actor.staffId, created: await findSection(ctx, id) };
        });
        // Just created, in the same transaction, by its owner: it can't be hidden.
        if (!created) throw new Error('A created Section did not read back');
        publish({ kind: 'section.changed', staffId });
        return c.json(created, 201);
      })

      // Reorder: every one of the actor's Sections, in the new order. Registered before
      // /:sectionId. A Section that isn't theirs (someone else's, or one already deleted)
      // answers 404, like every other route here; leaving one of theirs out means another
      // window added it, so that answers 409. Either way nothing changes.
      .put('/order', signedIn(auth), validate('json', reorderSectionsBody), async (c) => {
        const { sectionIds } = c.req.valid('json');
        const { staffId, sections } = await withActorTx(c, async (ctx) => {
          requireCanManageOwnSections(ctx.actor);
          const current = new Set(await listSectionIds(ctx));
          if (!sectionIds.every((id) => current.has(id))) throw new NotFoundError();
          if (current.size !== sectionIds.length) {
            throw new ConflictError(SECTIONS_CHANGED_MESSAGE);
          }
          await setSectionOrder(ctx, sectionIds);
          return { staffId: ctx.actor.staffId, sections: await listSections(ctx) };
        });
        publish({ kind: 'section.changed', staffId });
        return c.json(sections);
      })

      // Rename, collapse or expand.
      .patch(
        '/:sectionId',
        signedIn(auth),
        validate('param', sectionParams),
        validate('json', updateSectionBody),
        async (c) => {
          const { sectionId } = c.req.valid('param');
          const changes = c.req.valid('json');
          const { staffId, updated } = await withActorTx(c, async (ctx) => {
            requireCanManageOwnSections(ctx.actor);
            if (!(await updateSection(ctx, sectionId, changes))) throw new NotFoundError();
            return { staffId: ctx.actor.staffId, updated: await findSection(ctx, sectionId) };
          });
          if (!updated) throw new Error('An updated Section did not read back');
          publish({ kind: 'section.changed', staffId });
          return c.json(updated);
        },
      )

      // Delete: its Channels go back to the default Channels section.
      .delete('/:sectionId', signedIn(auth), validate('param', sectionParams), async (c) => {
        const { sectionId } = c.req.valid('param');
        const staffId = await withActorTx(c, async (ctx) => {
          requireCanManageOwnSections(ctx.actor);
          if (!(await deleteSection(ctx, sectionId))) throw new NotFoundError();
          return ctx.actor.staffId;
        });
        publish({ kind: 'section.changed', staffId });
        return c.body(null, 204);
      })
  );
}

/** Move a Channel into one of the Staff member's Sections, or back to the default section. */
export function placementRoutes({ auth, database }: Options) {
  const withActorTx = createWithActorTx(database);

  return new Hono().put(
    '/',
    signedIn(auth),
    validate('param', channelParams),
    validate('json', placeChannelBody),
    async (c) => {
      const { channelId } = c.req.valid('param');
      const { sectionId, position } = c.req.valid('json');
      const staffId = await withActorTx(c, async (ctx) => {
        const found = await findPlacementChannel(ctx, channelId);
        if (!found) throw new NotFoundError();
        requireCanPlaceChannel(ctx.actor, found);
        if (sectionId === null) {
          await unplaceChannel(ctx, channelId);
        } else {
          // Someone else's Section reads as missing.
          if (!(await isOwnSection(ctx, sectionId))) throw new NotFoundError();
          await placeChannel(ctx, channelId, sectionId, position);
        }
        return ctx.actor.staffId;
      });
      publish({ kind: 'section.changed', staffId });
      return c.body(null, 204);
    },
  );
}
