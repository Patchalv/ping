import { describe, expect, it } from 'vitest';
import type { Actor } from './actor';
import { allow, deny } from './decision';
import { canDeleteThread, canEditThread, canReadThreads, canStartThread } from './thread';

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

const byMember = { authorId: member.staffId, isSystem: false };
const bySomeoneElse = { authorId: '00000000-0000-4000-8000-0000000000b1', isSystem: false };

describe('canEditThread', () => {
  it.each([
    ['its author', member, byMember, channel('public', true)],
    [
      'a company Admin, someone else’s, in a Public channel',
      admin,
      bySomeoneElse,
      channel('public', false),
    ],
    [
      'a company Admin, someone else’s, in their Private channel',
      admin,
      bySomeoneElse,
      channel('private', true),
    ],
  ])('allows %s', (_name, actor, thread, target) => {
    expect(canEditThread(actor, target, thread)).toEqual(allow());
  });

  it('refuses a member who isn’t the author, Channel admins included', () => {
    expect(canEditThread(member, channel('public', true), bySomeoneElse)).toEqual(
      deny({
        kind: 'refused',
        message: 'Only its author or a company Admin can edit this Thread.',
      }),
    );
  });

  it('hides a Private channel from a company Admin who is not a member', () => {
    expect(canEditThread(admin, channel('private', false), bySomeoneElse)).toEqual(
      deny({ kind: 'hidden' }),
    );
  });

  it('refuses everyone in an Archived channel, the author and Admins included', () => {
    const refusal = deny({
      kind: 'refused',
      message: 'This Channel is archived, so nothing in it can be edited.',
    });
    expect(canEditThread(member, channel('public', true, true), byMember)).toEqual(refusal);
    expect(canEditThread(admin, channel('public', true, true), bySomeoneElse)).toEqual(refusal);
  });

  it('refuses a System thread, even to a company Admin', () => {
    expect(
      canEditThread(admin, channel('public', true), { authorId: null, isSystem: true }),
    ).toEqual(
      deny({ kind: 'refused', message: 'Ping started this Thread, so nobody can edit it.' }),
    );
  });
});

describe('canDeleteThread', () => {
  it.each([
    ['its author', member, byMember, channel('public', true)],
    ['a company Admin, someone else’s', admin, bySomeoneElse, channel('public', false)],
    [
      'a company Admin in an Archived channel',
      admin,
      bySomeoneElse,
      channel('public', false, true),
    ],
    [
      'a company Admin, a System thread',
      admin,
      { authorId: null, isSystem: true },
      channel('public', true),
    ],
  ])('allows %s', (_name, actor, thread, target) => {
    expect(canDeleteThread(actor, target, thread)).toEqual(allow());
  });

  it('refuses a member who isn’t the author', () => {
    expect(canDeleteThread(member, channel('public', true), bySomeoneElse)).toEqual(
      deny({
        kind: 'refused',
        message: 'Only its author or a company Admin can delete this Thread.',
      }),
    );
  });

  it('refuses the author in an Archived channel: only company Admins delete there', () => {
    expect(canDeleteThread(member, channel('public', true, true), byMember)).toEqual(
      deny({
        kind: 'refused',
        message: 'This Channel is archived, so only a company Admin can delete in it.',
      }),
    );
  });

  it('hides a Private channel from a company Admin who is not a member', () => {
    expect(canDeleteThread(admin, channel('private', false), bySomeoneElse)).toEqual(
      deny({ kind: 'hidden' }),
    );
  });
});
