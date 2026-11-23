import type { ResolvePolicy } from '@ping/shared';
import { describe, expect, it } from 'vitest';
import type { Actor } from './actor';
import { allow, deny } from './decision';
import {
  canDeleteThread,
  canEditThread,
  canReadThreads,
  canResolveThread,
  canStartThread,
} from './thread';

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

const byMember = { authorId: member.staffId };
const bySomeoneElse = { authorId: '00000000-0000-4000-8000-0000000000b1' };

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

  it('lets a company Admin edit a System thread: Admins edit any Thread', () => {
    expect(canEditThread(admin, channel('public', true), { authorId: null })).toEqual(allow());
  });

  it('refuses a member editing a System thread: it has no author', () => {
    expect(canEditThread(member, channel('public', true), { authorId: null })).toEqual(
      deny({
        kind: 'refused',
        message: 'Only its author or a company Admin can edit this Thread.',
      }),
    );
  });
});

describe('canResolveThread', () => {
  const access = (
    resolvePolicy: ResolvePolicy,
    place: 'channelAdmin' | 'member' | 'none',
    visibility: 'public' | 'private' = 'public',
    isArchived = false,
  ) => ({
    visibility,
    isArchived,
    isMember: place !== 'none',
    isChannelAdmin: place === 'channelAdmin',
    resolvePolicy,
  });
  const authorOnly = deny({
    kind: 'refused',
    message: 'Only the Thread’s author or a Channel admin can resolve or reopen it here.',
  });

  describe('when any Channel member may resolve', () => {
    it.each([
      ['its author', member, byMember, 'member'],
      ['another member', member, bySomeoneElse, 'member'],
      ['a Channel admin', member, bySomeoneElse, 'channelAdmin'],
      ['a company Admin who is a member', admin, bySomeoneElse, 'member'],
      ['a member, a System thread', member, { authorId: null }, 'member'],
    ] as const)('allows %s', (_name, actor, thread, place) => {
      expect(canResolveThread(actor, access('any_member', place), thread)).toEqual(allow());
    });
  });

  describe('when only the author and Channel admins may resolve', () => {
    it.each([
      ['its author', member, byMember, 'member'],
      ['a Channel admin, someone else’s', member, bySomeoneElse, 'channelAdmin'],
      ['a Channel admin, a System thread', member, { authorId: null }, 'channelAdmin'],
    ] as const)('allows %s', (_name, actor, thread, place) => {
      expect(canResolveThread(actor, access('author_and_channel_admins', place), thread)).toEqual(
        allow(),
      );
    });

    it.each([
      ['another member', member, bySomeoneElse],
      ['a company Admin who is a member: there is no Admin exception', admin, bySomeoneElse],
      ['a member, a System thread: it has no author', member, { authorId: null }],
    ] as const)('refuses %s', (_name, actor, thread) => {
      expect(
        canResolveThread(actor, access('author_and_channel_admins', 'member'), thread),
      ).toEqual(authorOnly);
    });
  });

  it('lets a Channel admin resolve a Deactivated Staff member’s Thread: only the author changed', () => {
    // A Deactivated author can't sign in, so the decision sees an ordinary Thread by
    // someone else; nothing about the author's state stops those allowed to resolve.
    expect(
      canResolveThread(member, access('author_and_channel_admins', 'channelAdmin'), bySomeoneElse),
    ).toEqual(allow());
    expect(canResolveThread(member, access('any_member', 'member'), bySomeoneElse)).toEqual(
      allow(),
    );
  });

  it.each([
    ['a Member', member],
    ['a company Admin: there is no Admin exception', admin],
  ])('refuses %s who has not joined a Public channel, saying to join', (_name, actor) => {
    expect(canResolveThread(actor, access('any_member', 'none'), bySomeoneElse)).toEqual(
      deny({ kind: 'refused', message: 'Join this Channel to resolve or reopen its Threads.' }),
    );
  });

  it('hides a Private channel from a company Admin who is not a member', () => {
    expect(canResolveThread(admin, access('any_member', 'none', 'private'), bySomeoneElse)).toEqual(
      deny({ kind: 'hidden' }),
    );
  });

  it('refuses everyone in an Archived channel, the author and Channel admins included', () => {
    const refusal = deny({
      kind: 'refused',
      message: 'This Channel is archived, so nobody can resolve or reopen its Threads.',
    });
    expect(
      canResolveThread(member, access('any_member', 'member', 'public', true), byMember),
    ).toEqual(refusal);
    expect(
      canResolveThread(member, access('any_member', 'channelAdmin', 'public', true), byMember),
    ).toEqual(refusal);
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
    ['a company Admin, a System thread', admin, { authorId: null }, channel('public', true)],
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
