// RLS suite: section and section_channel, as ping_app with raw SQL and no server code.
//
// Sections are personal (permissions.md › Policies): every command reaches only the
// acting Staff member's own rows, and nothing at all when app.staff_id is unset or they're
// Deactivated. A placement can only point at a Section of the same owner, which the
// composite foreign key enforces (foreign key checks bypass row-level security).
//
// clean_up_lost_access drops the Section placement of anyone who is no longer in the
// Channel, Public or Private; deactivate_staff_member drops all of theirs.
import { describe, expect, it } from 'vitest';
import {
  asOwner,
  asPingApp,
  createStaffMember,
  insertChannel,
  type Query,
} from '../../db/test-support';

/** Switches the case's transaction to another Staff member. */
const actAs = (query: Query, staffId: string | null) =>
  query(`select set_config('app.staff_id', $1, true)`, [staffId ?? '']);

/** An owner-side Section, outside row-level security. */
async function ownerSection(staffId: string, name = 'Teaching'): Promise<string> {
  return asOwner(async (query) => {
    const result = await query<{ id: string }>(
      'insert into section (staff_id, name, position) values ($1, $2, 0) returning id',
      [staffId, name],
    );
    const row = result.rows[0];
    if (!row) throw new Error('no section');
    return row.id;
  });
}

/** An owner-side placement, outside row-level security. */
const ownerPlacement = (staffId: string, channelId: string, sectionId: string) =>
  asOwner((query) =>
    query(
      'insert into section_channel (staff_id, channel_id, section_id, position) values ($1, $2, $3, 0)',
      [staffId, channelId, sectionId],
    ),
  );

/** The Channels a Staff member has placed, read as them inside the case's transaction. */
const placementsOf = async (query: Query, staffId: string) => {
  await actAs(query, staffId);
  return (await query<{ channel_id: string }>('select channel_id from section_channel')).rows.map(
    (row) => row.channel_id,
  );
};

const sectionNames = async (query: Query) =>
  (await query<{ name: string }>('select name from section order by name')).rows.map(
    (row) => row.name,
  );

/** Two Staff members, each with a Section and a Channel placed in it. */
async function twoOwners() {
  const owner = await createStaffMember();
  const other = await createStaffMember();
  const channel = await insertChannel({
    members: [{ staffId: owner.id, channelAdmin: true }, { staffId: other.id }],
  });
  const ownSection = await ownerSection(owner.id, 'Mine');
  const otherSection = await ownerSection(other.id, 'Theirs');
  await ownerPlacement(owner.id, channel.id, ownSection);
  await ownerPlacement(other.id, channel.id, otherSection);
  return { owner, other, channel, ownSection, otherSection };
}

describe('section', () => {
  it('shows a Staff member their own Sections and nobody else’s', async () => {
    const { owner } = await twoOwners();
    await asPingApp(owner.id, async (query) => {
      expect(await sectionNames(query)).toEqual(['Mine']);
    });
  });

  it('shows nothing when app.staff_id is unset', async () => {
    await twoOwners();
    await asPingApp(null, async (query) => {
      expect(await sectionNames(query)).toEqual([]);
    });
  });

  it('shows nothing to a Deactivated Staff member', async () => {
    const owner = await createStaffMember({ deactivated: true });
    await ownerSection(owner.id);
    await asPingApp(owner.id, async (query) => {
      expect(await sectionNames(query)).toEqual([]);
    });
  });

  it('inserts a Section for yourself, and refuses one for someone else', async () => {
    const { owner, other } = await twoOwners();
    await asPingApp(owner.id, async (query) => {
      await query(`insert into section (staff_id, name, position) values ($1, 'New', 1)`, [
        owner.id,
      ]);
      await expect(
        query(`insert into section (staff_id, name, position) values ($1, 'Sneaky', 1)`, [
          other.id,
        ]),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('refuses every insert when app.staff_id is unset', async () => {
    const owner = await createStaffMember();
    await asPingApp(null, async (query) => {
      await expect(
        query(`insert into section (staff_id, name, position) values ($1, 'New', 0)`, [owner.id]),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('updates only your own Sections, and can’t hand one to someone else', async () => {
    const { owner, other, ownSection, otherSection } = await twoOwners();
    await asPingApp(owner.id, async (query) => {
      const theirs = await query(`update section set name = 'Mine now' where id = $1`, [
        otherSection,
      ]);
      expect(theirs.rowCount).toBe(0);
      const mine = await query('update section set collapsed = true where id = $1', [ownSection]);
      expect(mine.rowCount).toBe(1);
      await expect(
        query('update section set staff_id = $2 where id = $1', [ownSection, other.id]),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('deletes only your own Sections, and their Channels go back to the default section', async () => {
    const { owner, other, ownSection, otherSection } = await twoOwners();
    await asPingApp(owner.id, async (query) => {
      expect((await query('delete from section where id = $1', [otherSection])).rowCount).toBe(0);
      expect((await query('delete from section where id = $1', [ownSection])).rowCount).toBe(1);
      expect(await placementsOf(query, owner.id)).toEqual([]);
      expect(await placementsOf(query, other.id)).toHaveLength(1);
    });
  });
});

describe('section_channel', () => {
  it('shows a Staff member their own placements and nobody else’s', async () => {
    const { owner, channel, ownSection } = await twoOwners();
    await asPingApp(owner.id, async (query) => {
      const rows = await query<{ section_id: string }>(
        'select section_id from section_channel where channel_id = $1',
        [channel.id],
      );
      expect(rows.rows).toEqual([{ section_id: ownSection }]);
    });
  });

  it('shows nothing when app.staff_id is unset, or to a Deactivated Staff member', async () => {
    const { channel } = await twoOwners();
    await asPingApp(null, async (query) => {
      expect((await query('select 1 from section_channel')).rowCount).toBe(0);
    });
    const gone = await createStaffMember({ deactivated: true });
    const section = await ownerSection(gone.id);
    await ownerPlacement(gone.id, channel.id, section);
    await asPingApp(gone.id, async (query) => {
      expect((await query('select 1 from section_channel')).rowCount).toBe(0);
    });
  });

  it('places a Channel in your own Section, never for someone else', async () => {
    const owner = await createStaffMember();
    const other = await createStaffMember();
    const channel = await insertChannel({
      members: [{ staffId: owner.id, channelAdmin: true }, { staffId: other.id }],
    });
    const ownSection = await ownerSection(owner.id);
    const otherSection = await ownerSection(other.id);
    await asPingApp(owner.id, async (query) => {
      await query(
        'insert into section_channel (staff_id, channel_id, section_id, position) values ($1, $2, $3, 0)',
        [owner.id, channel.id, ownSection],
      );
      expect(await placementsOf(query, owner.id)).toEqual([channel.id]);
    });
    await asPingApp(owner.id, async (query) => {
      await expect(
        query(
          'insert into section_channel (staff_id, channel_id, section_id, position) values ($1, $2, $3, 0)',
          [other.id, channel.id, otherSection],
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('can’t place your own Channel in someone else’s Section', async () => {
    const owner = await createStaffMember();
    const other = await createStaffMember();
    const channel = await insertChannel({ members: [{ staffId: owner.id, channelAdmin: true }] });
    const otherSection = await ownerSection(other.id);
    await asPingApp(owner.id, async (query) => {
      await expect(
        query(
          'insert into section_channel (staff_id, channel_id, section_id, position) values ($1, $2, $3, 0)',
          [owner.id, channel.id, otherSection],
        ),
      ).rejects.toThrow(/section_channel_section_fk/);
    });
  });

  it('refuses every insert when app.staff_id is unset', async () => {
    const owner = await createStaffMember();
    const channel = await insertChannel({ members: [{ staffId: owner.id, channelAdmin: true }] });
    const section = await ownerSection(owner.id);
    await asPingApp(null, async (query) => {
      await expect(
        query(
          'insert into section_channel (staff_id, channel_id, section_id, position) values ($1, $2, $3, 0)',
          [owner.id, channel.id, section],
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it('updates and deletes only your own placements', async () => {
    const { owner, other, channel } = await twoOwners();
    const spare = await ownerSection(owner.id, 'Spare');
    await asPingApp(owner.id, async (query) => {
      const moved = await query(
        'update section_channel set section_id = $2 where channel_id = $1',
        [channel.id, spare],
      );
      expect(moved.rowCount).toBe(1);
      const removed = await query('delete from section_channel where channel_id = $1', [
        channel.id,
      ]);
      expect(removed.rowCount).toBe(1);
      expect(await placementsOf(query, owner.id)).toEqual([]);
      expect(await placementsOf(query, other.id)).toEqual([channel.id]);
    });
    await asPingApp(owner.id, async (query) => {
      await expect(
        query('update section_channel set staff_id = $2 where channel_id = $1', [
          channel.id,
          other.id,
        ]),
      ).rejects.toThrow(/row-level security/);
    });
  });
});

const cleanUp = (query: Query, channelId: string) =>
  query('select public.clean_up_lost_access($1)', [channelId]);

const leave = (query: Query, channelId: string, staffId: string) =>
  query('delete from channel_member where channel_id = $1 and staff_id = $2', [channelId, staffId]);

describe('clean_up_lost_access and Section placement', () => {
  it.each(['public', 'private'] as const)(
    'drops the placement of someone who leaves a %s channel',
    async (visibility) => {
      const owner = await createStaffMember();
      const admin = await createStaffMember();
      const channel = await insertChannel({
        visibility,
        members: [{ staffId: admin.id, channelAdmin: true }, { staffId: owner.id }],
      });
      await ownerPlacement(owner.id, channel.id, await ownerSection(owner.id));
      await asPingApp(owner.id, async (query) => {
        await leave(query, channel.id, owner.id);
        await cleanUp(query, channel.id);
        expect(await placementsOf(query, owner.id)).toEqual([]);
      });
    },
  );

  it('keeps the placement of everyone still in the Channel', async () => {
    const { owner, other, channel } = await twoOwners();
    await asPingApp(other.id, async (query) => {
      await leave(query, channel.id, other.id);
      await cleanUp(query, channel.id);
      expect(await placementsOf(query, owner.id)).toEqual([channel.id]);
      expect(await placementsOf(query, other.id)).toEqual([]);
    });
  });

  it('keeps the placement of a former member’s other Channels', async () => {
    const { owner, channel, ownSection } = await twoOwners();
    const kept = await insertChannel({ members: [{ staffId: owner.id, channelAdmin: true }] });
    await ownerPlacement(owner.id, kept.id, ownSection);
    await asPingApp(owner.id, async (query) => {
      await leave(query, channel.id, owner.id);
      await cleanUp(query, channel.id);
      expect(await placementsOf(query, owner.id)).toEqual([kept.id]);
    });
  });

  it('does nothing when app.staff_id is unset', async () => {
    const { owner, channel } = await twoOwners();
    await asOwner((query) => leave(query, channel.id, owner.id));
    await asPingApp(null, async (query) => {
      await cleanUp(query, channel.id);
      expect(await placementsOf(query, owner.id)).toEqual([channel.id]);
    });
  });
});

describe('deactivate_staff_member and Section placement', () => {
  it('drops every placement of the Deactivated Staff member', async () => {
    const admin = await createStaffMember({ role: 'admin' });
    const { owner, other, channel } = await twoOwners();
    await asPingApp(admin.id, async (query) => {
      await query(
        'update staff_member set deactivated_at = now(), deactivated_by = $2 where id = $1',
        [owner.id, admin.id],
      );
      await query('select * from public.deactivate_staff_member($1)', [owner.id]);
      // Reactivating, so row-level security lets them read their rows again, back-fills nothing.
      await query(
        'update staff_member set deactivated_at = null, deactivated_by = null where id = $1',
        [owner.id],
      );
      expect(await placementsOf(query, owner.id)).toEqual([]);
      expect(await placementsOf(query, other.id)).toEqual([channel.id]);
    });
  });
});
