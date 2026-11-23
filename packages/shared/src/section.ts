// Sidebar Sections (screens.md › Sidebar, data-model.md › Sidebar Sections): the request
// schemas both apps use, and the shape the server answers with. Sections are personal:
// nobody but their owner ever sees them.
import { z } from 'zod';

export const SECTION_NAME_MAX = 40;

// Every rule a Staff member can trip has a plain-English message: the UI shows it as is.

const sectionName = z
  .string({ error: 'Give the Section a name.' })
  .trim()
  .min(1, 'Give the Section a name.')
  .max(SECTION_NAME_MAX, `Keep the name to ${SECTION_NAME_MAX} characters or fewer.`);

const sectionId = z.uuid({ error: 'That isn’t a Section.' });

/** POST /api/sections: + New section. It goes below the Staff member's other Sections. */
export const createSectionBody = z.object({ name: sectionName });
export type CreateSectionBody = z.input<typeof createSectionBody>;

/** PATCH /api/sections/:sectionId: rename it, or collapse or expand it. */
export const updateSectionBody = z
  .object({
    name: sectionName.optional(),
    collapsed: z.boolean({ error: 'Say whether the Section is collapsed.' }).optional(),
  })
  .refine((body) => body.name !== undefined || body.collapsed !== undefined, {
    error: 'Rename the Section, or collapse or expand it.',
  });
export type UpdateSectionBody = z.input<typeof updateSectionBody>;

/** PUT /api/sections/order: every one of the Staff member's Sections, in their new order. */
export const reorderSectionsBody = z.object({
  sectionIds: z
    .array(sectionId, { error: 'List the Sections in their new order.' })
    .refine((ids) => new Set(ids).size === ids.length, { error: 'List each Section once.' }),
});

/** Routes under /api/sections/:sectionId. */
export const sectionParams = z.object({ sectionId });

/**
 * PUT /api/channels/:channelId/section: move a Channel into one of the Staff member's
 * Sections, at `position` (its end when left out), or back to the default Channels
 * section with `sectionId: null`.
 */
export const placeChannelBody = z.object({
  sectionId: z
    .uuid({
      error: (issue) =>
        issue.input === undefined
          ? 'Choose a Section, or the Channels section.'
          : 'That isn’t a Section.',
    })
    .nullable(),
  position: z
    .int({ error: 'That isn’t a place in the Section.' })
    .min(0, 'That isn’t a place in the Section.')
    .optional(),
});
export type PlaceChannelBody = z.input<typeof placeChannelBody>;

/**
 * One of the Staff member's Sections, as the sidebar shows it: its Channels in their
 * order. A Channel in no Section sits in the default Channels section.
 */
export type SectionView = {
  id: string;
  name: string;
  collapsed: boolean;
  channelIds: string[];
};
