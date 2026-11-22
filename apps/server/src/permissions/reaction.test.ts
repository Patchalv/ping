import { describe, expect, it } from 'vitest';
import type { Actor } from './actor';
import { allow, deny } from './decision';
import { canReact } from './reaction';

const member: Actor = { staffId: '00000000-0000-4000-8000-0000000000a1', role: 'member' };
const admin: Actor = { staffId: '00000000-0000-4000-8000-0000000000a2', role: 'admin' };

const channel = (visibility: 'public' | 'private', isMember: boolean, isArchived = false) => ({
  visibility,
  isMember,
  isArchived,
});

describe('canReact', () => {
  it.each([
    ['a member of a Private channel', member, channel('private', true)],
    ['a member of a Public channel', member, channel('public', true)],
    ['a company Admin who is a member', admin, channel('public', true)],
  ])('allows %s', (_name, actor, target) => {
    expect(canReact(actor, target)).toEqual(allow());
  });

  it.each([
    ['a Member', member],
    ['a company Admin: there is no Admin exception', admin],
  ])('tells %s reading a Public channel to join first', (_name, actor) => {
    expect(canReact(actor, channel('public', false))).toEqual(
      deny({ kind: 'refused', message: 'Join this Channel to react.' }),
    );
  });

  it.each([
    ['a Member', member],
    ['a company Admin', admin],
  ])('hides a Private channel from %s who is not a member', (_name, actor) => {
    expect(canReact(actor, channel('private', false))).toEqual(deny({ kind: 'hidden' }));
  });

  it('refuses everyone in an Archived channel, members and Admins included', () => {
    const refusal = deny({
      kind: 'refused',
      message: 'This Channel is archived, so nobody can react in it.',
    });
    expect(canReact(member, channel('public', true, true))).toEqual(refusal);
    expect(canReact(admin, channel('public', true, true))).toEqual(refusal);
  });
});
