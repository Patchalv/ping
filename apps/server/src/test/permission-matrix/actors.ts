// The permission matrix's standard actors (docs/spec/testing.md). Each is a real Staff
// member with a real session, signed in through Better Auth.
import { asOwner, createStaffMember, type StaffFixture } from '../../db/test-support';
import { signIn, type TestApp } from '../test-app';

export const STANDARD_ACTORS = [
  'author',
  'channelAdmin',
  'channelMember',
  'nonMemberMember',
  'adminNonMember',
  'adminMember',
  'deactivated',
] as const;

export type ActorKind = (typeof STANDARD_ACTORS)[number];

export type Actor = {
  kind: ActorKind;
  staff: StaffFixture;
  /** The Cookie header for this actor's requests. */
  cookie: string;
};

const ADMINS: ReadonlySet<ActorKind> = new Set(['adminNonMember', 'adminMember']);

/**
 * Each actor's place in the row's Channel. The author is an ordinary member who started the
 * row's Thread, when it has one. The Deactivated actor was a member before their
 * Deactivation.
 */
export const CHANNEL_ROLE: Record<ActorKind, 'channelAdmin' | 'member' | null> = {
  author: 'member',
  channelAdmin: 'channelAdmin',
  channelMember: 'member',
  nonMemberMember: null,
  adminNonMember: null,
  adminMember: 'member',
  deactivated: 'member',
};

/**
 * Creates a signed-in Staff member for `kind`. Channel relationships (author, Channel
 * admin, member) are set up per row by the Channel fixtures, which arrive with the first
 * Channel slice.
 *
 * The Deactivated actor signs in while active and is then Deactivated the way the app
 * does it: deactivated_at set and their sessions deleted. Their old cookie is what an
 * attacker would replay.
 */
export async function createActor(testApp: TestApp, kind: ActorKind): Promise<Actor> {
  const staff = await createStaffMember({ role: ADMINS.has(kind) ? 'admin' : 'member' });
  const cookie = await signIn(testApp, staff);
  if (kind === 'deactivated') {
    const admin = await createStaffMember({ role: 'admin' });
    await asOwner(async (query) => {
      await query(
        'update staff_member set deactivated_at = now(), deactivated_by = $2 where id = $1',
        [staff.id, admin.id],
      );
      await query('delete from session where user_id = $1', [staff.id]);
    });
  }
  return { kind, staff, cookie };
}
