import { describe, expect, it } from 'vitest';
import { ForbiddenError, NotFoundError } from '../lib/errors';
import type { Actor } from './actor';
import {
  canAddChannelMember,
  canBrowseChannels,
  canCreateChannel,
  canJoinChannel,
  canLeaveChannel,
  canListOwnChannels,
  canReadChannel,
  canRemoveChannelMember,
  canSetChannelAdmin,
  channelMemberActions,
  LAST_CHANNEL_ADMIN_MESSAGE,
  needsCompanyAdminPower,
  ONLY_MEMBER_ARCHIVED_MESSAGE,
  ONLY_MEMBER_MESSAGE,
  requireCanCreateChannel,
  requireCanReadChannel,
} from './channel';
import { allow, deny, requireAllowed } from './decision';

const member: Actor = { staffId: '00000000-0000-4000-8000-0000000000a1', role: 'member' };
const admin: Actor = { staffId: '00000000-0000-4000-8000-0000000000a2', role: 'admin' };

const publicChannel = { visibility: 'public' as const, isMember: false, isArchived: false };
const privateChannel = { visibility: 'private' as const, isMember: false, isArchived: false };
const privateAsMember = { visibility: 'private' as const, isMember: true, isArchived: false };

describe('canCreateChannel', () => {
  it.each([
    ['a Member', member],
    ['a company Admin', admin],
  ])('allows %s', (_name, actor) => {
    expect(canCreateChannel(actor)).toEqual(allow());
  });
});

describe('canListOwnChannels', () => {
  it.each([
    ['a Member', member],
    ['a company Admin', admin],
  ])('allows %s', (_name, actor) => {
    expect(canListOwnChannels(actor)).toEqual(allow());
  });
});

describe('canReadChannel', () => {
  it.each([
    ['a Member, in a Public channel', member, publicChannel],
    ['a company Admin, in a Public channel', admin, publicChannel],
    ['a member of a Private channel', member, privateAsMember],
    ['a company Admin who is a member of a Private channel', admin, privateAsMember],
  ])('allows %s', (_name, actor, channel) => {
    expect(canReadChannel(actor, channel)).toEqual(allow());
  });

  it.each([
    ['a Member', member],
    ['a company Admin: there is no Admin exception', admin],
  ])('hides a Private channel from %s who is not a member', (_name, actor) => {
    expect(canReadChannel(actor, privateChannel)).toEqual(deny({ kind: 'hidden' }));
  });
});

describe('canBrowseChannels', () => {
  it.each([
    ['a Member', member],
    ['a company Admin', admin],
  ])('allows %s', (_name, actor) => {
    expect(canBrowseChannels(actor)).toEqual(allow());
  });
});

describe('canJoinChannel', () => {
  const live = { isArchived: false };

  it.each([
    ['a Member', member],
    ['a company Admin', admin],
  ])('lets %s join a Public channel', (_name, actor) => {
    expect(canJoinChannel(actor, { ...publicChannel, ...live })).toEqual(allow());
  });

  it('lets a member join a Public channel again, which changes nothing', () => {
    expect(canJoinChannel(member, { ...publicChannel, ...live, isMember: true })).toEqual(allow());
  });

  it.each([
    ['a Member', member],
    ['a company Admin: there is no Admin exception', admin],
  ])('hides a Private channel from %s who is not a member', (_name, actor) => {
    expect(canJoinChannel(actor, { ...privateChannel, ...live })).toEqual(deny({ kind: 'hidden' }));
  });

  it('refuses joining a Private channel the actor is already in: only Public ones can be joined', () => {
    expect(canJoinChannel(member, { ...privateAsMember, ...live })).toEqual(
      deny({
        kind: 'refused',
        message: 'Only Public channels can be joined. A Channel admin adds people to this one.',
      }),
    );
  });

  it('refuses joining an Archived channel', () => {
    expect(canJoinChannel(member, { ...publicChannel, isArchived: true })).toEqual(
      deny({
        kind: 'refused',
        message: 'This Channel is archived, so nobody can join it.',
      }),
    );
  });
});

describe('canLeaveChannel', () => {
  const plainMember = { isMember: true, isChannelAdmin: false };
  const channelAdmin = { isMember: true, isChannelAdmin: true };
  const nobodyElse = { otherActiveChannelAdmins: 0, otherActiveMembers: 0 };

  it.each([
    ['a plain member of a Public channel', { ...publicChannel, ...plainMember, ...nobodyElse }],
    ['a plain member of a Private channel', { ...privateAsMember, ...plainMember, ...nobodyElse }],
    [
      'a Channel admin when another active Channel admin stays',
      { ...publicChannel, ...channelAdmin, otherActiveChannelAdmins: 1, otherActiveMembers: 1 },
    ],
  ])('allows %s', (_name, channel) => {
    expect(canLeaveChannel(member, channel)).toEqual(allow());
  });

  it('stops the last active Channel admin while other members stay', () => {
    expect(
      canLeaveChannel(member, {
        ...publicChannel,
        ...channelAdmin,
        otherActiveChannelAdmins: 0,
        otherActiveMembers: 2,
      }),
    ).toEqual(deny({ kind: 'refused', message: LAST_CHANNEL_ADMIN_MESSAGE }));
    expect(LAST_CHANNEL_ADMIN_MESSAGE).toBe(
      'You’re the last Channel admin here. Make another member Channel admin before you leave.',
    );
  });

  it('stops the only member of an Archived channel without telling them to archive it', () => {
    expect(
      canLeaveChannel(member, {
        ...publicChannel,
        ...channelAdmin,
        ...nobodyElse,
        isArchived: true,
      }),
    ).toEqual(deny({ kind: 'refused', message: ONLY_MEMBER_ARCHIVED_MESSAGE }));
    expect(ONLY_MEMBER_ARCHIVED_MESSAGE).toBe(
      'You’re the only member of this Channel. Add someone and make them Channel admin, then leave.',
    );
  });

  it('stops the only member, and says to archive the Channel or hand it over', () => {
    expect(canLeaveChannel(admin, { ...privateAsMember, ...channelAdmin, ...nobodyElse })).toEqual(
      deny({ kind: 'refused', message: ONLY_MEMBER_MESSAGE }),
    );
    expect(ONLY_MEMBER_MESSAGE).toBe(
      'You’re the only member of this Channel. Archive it instead, or add someone, make them Channel admin, then leave.',
    );
  });

  it('refuses leaving a Public channel the actor is not a member of', () => {
    expect(
      canLeaveChannel(member, {
        ...publicChannel,
        isChannelAdmin: false,
        otherActiveChannelAdmins: 1,
        otherActiveMembers: 1,
      }),
    ).toEqual(
      deny({
        kind: 'refused',
        message: 'You’re not a member of this Channel, so there’s nothing to leave.',
      }),
    );
  });

  it.each([
    ['a Member', member],
    ['a company Admin', admin],
  ])('hides a Private channel from %s who is not a member', (_name, actor) => {
    expect(
      canLeaveChannel(actor, {
        ...privateChannel,
        isChannelAdmin: false,
        otherActiveChannelAdmins: 1,
        otherActiveMembers: 1,
      }),
    ).toEqual(deny({ kind: 'hidden' }));
  });
});

// Members and Channel admins (#37). `place` builds the actor's place in a Channel.
const place = (
  visibility: 'public' | 'private',
  role: 'channelAdmin' | 'member' | null,
  isArchived = false,
) => ({
  visibility,
  isMember: role !== null,
  isChannelAdmin: role === 'channelAdmin',
  isArchived,
});
const ARCHIVED = 'This Channel is archived, so its members can’t change. Unarchive it first.';
const activeStaff = { isActiveStaff: true };

describe('canAddChannelMember', () => {
  it.each([
    ['a plain member of a Public channel', member, place('public', 'member')],
    ['a Channel admin of a Public channel', member, place('public', 'channelAdmin')],
    ['a Channel admin of a Private channel', member, place('private', 'channelAdmin')],
  ])('allows %s', (_name, actor, channel) => {
    expect(canAddChannelMember(actor, channel, activeStaff)).toEqual(allow());
  });

  it.each([
    ['a Member', member],
    ['a company Admin: there is no Admin exception', admin],
  ])('refuses %s who has not joined the Public channel', (_name, actor) => {
    expect(canAddChannelMember(actor, place('public', null), activeStaff)).toEqual(
      deny({ kind: 'refused', message: 'Join this Channel before you add people to it.' }),
    );
  });

  it.each([
    ['a plain member', member],
    ['a company Admin who is a plain member', admin],
  ])('refuses %s of a Private channel', (_name, actor) => {
    expect(canAddChannelMember(actor, place('private', 'member'), activeStaff)).toEqual(
      deny({ kind: 'refused', message: 'Only Channel admins add people to a Private channel.' }),
    );
  });

  it('hides a Private channel from a company Admin who is not a member', () => {
    expect(canAddChannelMember(admin, place('private', null), activeStaff)).toEqual(
      deny({ kind: 'hidden' }),
    );
  });

  it('refuses everyone in an Archived channel', () => {
    expect(canAddChannelMember(member, place('public', 'channelAdmin', true), activeStaff)).toEqual(
      deny({ kind: 'refused', message: ARCHIVED }),
    );
  });

  it('refuses adding someone who is not an active Staff member', () => {
    expect(
      canAddChannelMember(member, place('public', 'channelAdmin'), { isActiveStaff: false }),
    ).toEqual(
      deny({
        kind: 'refused',
        message: 'Only active Staff members can be added. Invited and Deactivated people can’t.',
      }),
    );
  });
});

describe('canRemoveChannelMember', () => {
  const someoneElse = { staffId: '00000000-0000-4000-8000-0000000000b1', isMember: true };

  it.each([
    ['a Public channel', place('public', 'channelAdmin')],
    ['a Private channel', place('private', 'channelAdmin')],
  ])('allows a Channel admin of %s', (_name, channel) => {
    expect(canRemoveChannelMember(member, channel, someoneElse)).toEqual(allow());
  });

  it.each([
    ['a plain member', member, place('public', 'member')],
    ['a company Admin who is not a member', admin, place('public', null)],
    ['a company Admin who is a plain member', admin, place('private', 'member')],
  ])('refuses %s', (_name, actor, channel) => {
    expect(canRemoveChannelMember(actor, channel, someoneElse)).toEqual(
      deny({ kind: 'refused', message: 'Only Channel admins remove members.' }),
    );
  });

  it('hides a Private channel from a company Admin who is not a member', () => {
    expect(canRemoveChannelMember(admin, place('private', null), someoneElse)).toEqual(
      deny({ kind: 'hidden' }),
    );
  });

  it('refuses everyone in an Archived channel', () => {
    expect(
      canRemoveChannelMember(member, place('public', 'channelAdmin', true), someoneElse),
    ).toEqual(deny({ kind: 'refused', message: ARCHIVED }));
  });

  it('sends a Channel admin removing themself to Leave, which keeps the last Channel admin', () => {
    expect(
      canRemoveChannelMember(member, place('public', 'channelAdmin'), {
        staffId: member.staffId,
        isMember: true,
      }),
    ).toEqual(deny({ kind: 'refused', message: 'To leave this Channel yourself, use Leave.' }));
  });

  it('refuses removing someone who is not a member', () => {
    expect(
      canRemoveChannelMember(member, place('public', 'channelAdmin'), {
        ...someoneElse,
        isMember: false,
      }),
    ).toEqual(deny({ kind: 'refused', message: 'They’re not a member of this Channel.' }));
  });
});

describe('canSetChannelAdmin', () => {
  const memberTarget = {
    staffId: '00000000-0000-4000-8000-0000000000b1',
    isActiveStaff: true,
    isMember: true,
    isChannelAdmin: false,
    otherActiveChannelAdmins: 1,
  };
  const nonMemberTarget = { ...memberTarget, isMember: false };
  const channelAdminTarget = { ...memberTarget, isChannelAdmin: true };

  it.each([
    ['a Channel admin of a Public channel', member, place('public', 'channelAdmin')],
    ['a Channel admin of a Private channel', member, place('private', 'channelAdmin')],
    ['a company Admin who is not a member of a Public channel', admin, place('public', null)],
    ['a company Admin who is a plain member of a Public channel', admin, place('public', 'member')],
  ])('lets %s appoint a member and remove the role', (_name, actor, channel) => {
    expect(canSetChannelAdmin(actor, channel, memberTarget, true)).toEqual(allow());
    expect(canSetChannelAdmin(actor, channel, channelAdminTarget, false)).toEqual(allow());
  });

  it('lets a company Admin appoint someone who is not a member of a Public channel, themself included', () => {
    expect(canSetChannelAdmin(admin, place('public', null), nonMemberTarget, true)).toEqual(
      allow(),
    );
    expect(
      canSetChannelAdmin(
        admin,
        place('public', null),
        { ...nonMemberTarget, staffId: admin.staffId },
        true,
      ),
    ).toEqual(allow());
  });

  it('asks a Channel admin to add someone before appointing them', () => {
    expect(
      canSetChannelAdmin(member, place('private', 'channelAdmin'), nonMemberTarget, true),
    ).toEqual(
      deny({
        kind: 'refused',
        message: 'Add them to the Channel before you make them Channel admin.',
      }),
    );
  });

  it.each([
    ['a plain member of a Public channel', member, place('public', 'member')],
    ['a Member who is not in a Public channel', member, place('public', null)],
    [
      'a company Admin who is a plain member of a Private channel',
      admin,
      place('private', 'member'),
    ],
  ])('refuses %s', (_name, actor, channel) => {
    expect(canSetChannelAdmin(actor, channel, memberTarget, true)).toEqual(
      deny({ kind: 'refused', message: 'Only Channel admins appoint or remove Channel admins.' }),
    );
  });

  it('hides a Private channel from a company Admin who is not a member', () => {
    expect(canSetChannelAdmin(admin, place('private', null), memberTarget, true)).toEqual(
      deny({ kind: 'hidden' }),
    );
  });

  it('refuses everyone in an Archived channel, company Admins included', () => {
    expect(
      canSetChannelAdmin(admin, place('public', 'channelAdmin', true), memberTarget, true),
    ).toEqual(deny({ kind: 'refused', message: ARCHIVED }));
  });

  it('refuses appointing someone who is not an active Staff member', () => {
    expect(
      canSetChannelAdmin(
        member,
        place('public', 'channelAdmin'),
        { ...memberTarget, isActiveStaff: false },
        true,
      ),
    ).toEqual(
      deny({ kind: 'refused', message: 'Only active Staff members can be Channel admins.' }),
    );
  });

  it('keeps at least one active Channel admin, company Admins included', () => {
    const last = { ...channelAdminTarget, staffId: admin.staffId, otherActiveChannelAdmins: 0 };
    expect(canSetChannelAdmin(admin, place('public', 'channelAdmin'), last, false)).toEqual(
      deny({
        kind: 'refused',
        message: 'A Channel needs an active Channel admin. Make someone else Channel admin first.',
      }),
    );
  });

  it('refuses removing the role from someone who is not a member', () => {
    expect(
      canSetChannelAdmin(member, place('public', 'channelAdmin'), nonMemberTarget, false),
    ).toEqual(deny({ kind: 'refused', message: 'They’re not a member of this Channel.' }));
  });
});

describe('needsCompanyAdminPower', () => {
  it('uses the ordinary policy for a Channel admin changing a member', () => {
    expect(needsCompanyAdminPower(place('public', 'channelAdmin'), { isMember: true })).toBe(false);
  });

  it.each([
    ['a company Admin who is not Channel admin', place('public', 'member'), true],
    ['someone outside the Channel', place('public', 'channelAdmin'), false],
  ])('takes the company Admin power for %s', (_name, channel, isMember) => {
    expect(needsCompanyAdminPower(channel, { isMember })).toBe(true);
  });
});

describe('channelMemberActions', () => {
  it.each([
    ['a plain member of a Public channel', member, place('public', 'member'), [true, false, false]],
    ['a Channel admin', member, place('private', 'channelAdmin'), [true, true, true]],
    [
      'a plain member of a Private channel',
      member,
      place('private', 'member'),
      [false, false, false],
    ],
    [
      'a company Admin who is not in a Public channel',
      admin,
      place('public', null),
      [false, false, true],
    ],
    [
      'a company Admin who is a plain member of a Private channel',
      admin,
      place('private', 'member'),
      [false, false, false],
    ],
    [
      'a Channel admin of an Archived channel',
      admin,
      place('public', 'channelAdmin', true),
      [false, false, false],
    ],
  ])(
    'shows %s only the controls the server allows',
    (_name, actor, channel, [add, remove, setChannelAdmin]) => {
      expect(channelMemberActions(actor, channel)).toEqual({ add, remove, setChannelAdmin });
    },
  );
});

describe('the require helpers', () => {
  it('return quietly on allow', () => {
    expect(() => requireCanCreateChannel(member)).not.toThrow();
    expect(() => requireCanReadChannel(member, publicChannel)).not.toThrow();
  });

  it('throw NotFoundError for a Channel the actor cannot see, so it answers 404', () => {
    expect(() => requireCanReadChannel(admin, privateChannel)).toThrow(NotFoundError);
  });

  it('throw ForbiddenError, with the message the UI shows, for a visible refusal', () => {
    const decision = deny({ kind: 'refused', message: 'Only Channel admins can do that.' });
    expect(() => requireAllowed(decision)).toThrow(
      new ForbiddenError('Only Channel admins can do that.'),
    );
  });
});
