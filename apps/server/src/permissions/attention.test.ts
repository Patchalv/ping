import { describe, expect, it } from 'vitest';
import type { Actor } from './actor';
import { canListOwnSaved, canMuteChannel, canMuteThread, canSaveThread } from './attention';
import { allow, deny } from './decision';
import type { ThreadChannelAccess } from './thread';

const member: Actor = { staffId: '00000000-0000-4000-8000-0000000000a1', role: 'member' };
const admin: Actor = { staffId: '00000000-0000-4000-8000-0000000000a2', role: 'admin' };

const channel = (
  visibility: 'public' | 'private',
  isMember: boolean,
  isArchived = false,
): ThreadChannelAccess => ({ visibility, isMember, isArchived });

describe('canListOwnSaved', () => {
  it.each([member, admin])('allows anyone', (actor) => {
    expect(canListOwnSaved(actor)).toEqual(allow());
  });
});

describe.each([
  ['canSaveThread', canSaveThread],
  ['canMuteThread', canMuteThread],
])('%s: anyone who can read the Thread', (_name, decide) => {
  it.each([
    ['a member of a Public channel', channel('public', true)],
    ['a non-member of a Public channel', channel('public', false)],
    ['a member of a Private channel', channel('private', true)],
    ['a member of an Archived channel', channel('public', true, true)],
  ])('allows %s', (_who, access) => {
    expect(decide(member, access)).toEqual(allow());
  });

  it('hides a Private channel they aren’t in, from Admins too', () => {
    expect(decide(admin, channel('private', false))).toEqual(deny({ kind: 'hidden' }));
  });
});

describe('canMuteChannel: members only', () => {
  it.each([
    ['a Public channel', channel('public', true)],
    ['a Private channel', channel('private', true)],
    ['an Archived channel', channel('public', true, true)],
  ])('allows a member of %s', (_which, access) => {
    expect(canMuteChannel(member, access)).toEqual(allow());
  });

  it('refuses a non-member of a Public channel, Admins included', () => {
    for (const actor of [member, admin]) {
      expect(canMuteChannel(actor, channel('public', false))).toEqual(
        deny({ kind: 'refused', message: 'Join this Channel to mute it.' }),
      );
    }
  });

  it('hides a Private channel they aren’t in, from Admins too', () => {
    expect(canMuteChannel(admin, channel('private', false))).toEqual(deny({ kind: 'hidden' }));
  });
});
