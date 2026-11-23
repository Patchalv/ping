import { describe, expect, it } from 'vitest';
import type { Actor } from './actor';
import { allow, deny } from './decision';
import { canManageOwnSections, canPlaceChannel } from './section';

const member: Actor = { staffId: '00000000-0000-4000-8000-0000000000a1', role: 'member' };
const admin: Actor = { staffId: '00000000-0000-4000-8000-0000000000a2', role: 'admin' };

const channel = (visibility: 'public' | 'private', isMember: boolean) => ({
  visibility,
  isMember,
});

describe('canManageOwnSections', () => {
  it.each([
    ['a Member', member],
    ['a company Admin', admin],
  ])('allows %s: row-level security keeps everyone to their own', (_name, actor) => {
    expect(canManageOwnSections(actor)).toEqual(allow());
  });
});

describe('canPlaceChannel', () => {
  it.each([
    ['a member of a Public channel', member, channel('public', true)],
    ['a member of a Private channel', member, channel('private', true)],
    ['a company Admin who is a member', admin, channel('public', true)],
  ])('allows %s', (_name, actor, target) => {
    expect(canPlaceChannel(actor, target)).toEqual(allow());
  });

  it.each([
    ['a Member', member],
    ['a company Admin: there is no Admin exception', admin],
  ])('tells %s reading a Public channel to join first', (_name, actor) => {
    expect(canPlaceChannel(actor, channel('public', false))).toEqual(
      deny({ kind: 'refused', message: 'Join this Channel to put it in one of your Sections.' }),
    );
  });

  it.each([
    ['a Member', member],
    ['a company Admin', admin],
  ])('hides a Private channel from %s who is not a member', (_name, actor) => {
    expect(canPlaceChannel(actor, channel('private', false))).toEqual(deny({ kind: 'hidden' }));
  });
});
