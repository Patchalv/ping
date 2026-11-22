import { describe, expect, it } from 'vitest';
import type { Actor } from './actor';
import { allow, deny } from './decision';
import { canReadThreads, canStartThread } from './thread';

const member: Actor = { staffId: '00000000-0000-4000-8000-0000000000a1', role: 'member' };
const admin: Actor = { staffId: '00000000-0000-4000-8000-0000000000a2', role: 'admin' };

const channel = (visibility: 'public' | 'private', isMember: boolean, isArchived = false) => ({
  visibility,
  isMember,
  isArchived,
});

describe('canStartThread', () => {
  it.each([
    ['a member of a Public channel', member, channel('public', true)],
    ['a member of a Private channel', member, channel('private', true)],
    ['a company Admin who is a member', admin, channel('public', true)],
  ])('allows %s', (_name, actor, target) => {
    expect(canStartThread(actor, target)).toEqual(allow());
  });

  it.each([
    ['a Member', member],
    ['a company Admin: there is no Admin exception', admin],
  ])('refuses %s who has not joined a Public channel, saying to join', (_name, actor) => {
    expect(canStartThread(actor, channel('public', false))).toEqual(
      deny({ kind: 'refused', message: 'Join this Channel to start a Thread in it.' }),
    );
  });

  it.each([
    ['a Member', member],
    ['a company Admin', admin],
  ])('hides a Private channel from %s who is not a member', (_name, actor) => {
    expect(canStartThread(actor, channel('private', false))).toEqual(deny({ kind: 'hidden' }));
  });

  it('refuses everyone in an Archived channel, members included', () => {
    const refusal = deny({
      kind: 'refused',
      message: 'This Channel is archived, so nobody can start Threads in it.',
    });
    expect(canStartThread(member, channel('public', true, true))).toEqual(refusal);
    expect(canStartThread(admin, channel('public', false, true))).toEqual(refusal);
  });
});

describe('canReadThreads', () => {
  it.each([
    ['a non-member of a Public channel', member, channel('public', false)],
    ['a member of a Private channel', member, channel('private', true)],
    ['anyone in an Archived Public channel', admin, channel('public', false, true)],
  ])('allows %s', (_name, actor, target) => {
    expect(canReadThreads(actor, target)).toEqual(allow());
  });

  it('hides a Private channel’s Threads from a company Admin who is not a member', () => {
    expect(canReadThreads(admin, channel('private', false))).toEqual(deny({ kind: 'hidden' }));
  });
});
