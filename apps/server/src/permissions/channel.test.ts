import { describe, expect, it } from 'vitest';
import { ForbiddenError, NotFoundError } from '../lib/errors';
import type { Actor } from './actor';
import {
  canBrowseChannels,
  canCreateChannel,
  canJoinChannel,
  canLeaveChannel,
  canListOwnChannels,
  canReadChannel,
  LAST_CHANNEL_ADMIN_MESSAGE,
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
