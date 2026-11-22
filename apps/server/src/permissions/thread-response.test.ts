import { describe, expect, it } from 'vitest';
import type { Actor } from './actor';
import { allow, deny } from './decision';
import {
  canDeleteThreadResponse,
  canEditThreadResponse,
  canSendThreadResponse,
} from './thread-response';

const member: Actor = { staffId: '00000000-0000-4000-8000-0000000000a1', role: 'member' };
const admin: Actor = { staffId: '00000000-0000-4000-8000-0000000000a2', role: 'admin' };
const someoneElse = '00000000-0000-4000-8000-0000000000b1';

const channel = (visibility: 'public' | 'private', isMember: boolean, isArchived = false) => ({
  visibility,
  isMember,
  isArchived,
});

describe('canSendThreadResponse', () => {
  it.each([
    ['a member', member, channel('private', true)],
    ['a company Admin who is a member', admin, channel('public', true)],
  ])('allows %s', (_name, actor, target) => {
    expect(canSendThreadResponse(actor, target)).toEqual(allow());
  });

  it.each([
    ['a Member', member],
    ['a company Admin: there is no Admin exception', admin],
  ])('tells %s reading a Public channel to join first', (_name, actor) => {
    expect(canSendThreadResponse(actor, channel('public', false))).toEqual(
      deny({ kind: 'refused', message: 'Join this Channel to send a Thread Response.' }),
    );
  });

  it('hides a Private channel from a non-member', () => {
    expect(canSendThreadResponse(admin, channel('private', false))).toEqual(
      deny({ kind: 'hidden' }),
    );
  });

  it('refuses everyone in an Archived channel', () => {
    expect(canSendThreadResponse(member, channel('public', true, true))).toEqual(
      deny({
        kind: 'refused',
        message: 'This Channel is archived, so nobody can send Thread Responses in it.',
      }),
    );
  });
});

describe('canEditThreadResponse', () => {
  it.each([
    ['its author', member, member.staffId, channel('public', true)],
    ['a company Admin, someone else’s', admin, someoneElse, channel('public', false)],
  ])('allows %s', (_name, actor, authorId, target) => {
    expect(canEditThreadResponse(actor, target, { authorId })).toEqual(allow());
  });

  it('refuses a member who isn’t the author', () => {
    expect(
      canEditThreadResponse(member, channel('public', true), { authorId: someoneElse }),
    ).toEqual(
      deny({
        kind: 'refused',
        message: 'Only its author or a company Admin can edit this Thread Response.',
      }),
    );
  });

  it('refuses everyone in an Archived channel', () => {
    expect(
      canEditThreadResponse(admin, channel('public', true, true), { authorId: admin.staffId }),
    ).toEqual(
      deny({
        kind: 'refused',
        message: 'This Channel is archived, so nothing in it can be edited.',
      }),
    );
  });

  it('hides a Private channel from a company Admin who is not a member', () => {
    expect(
      canEditThreadResponse(admin, channel('private', false), { authorId: someoneElse }),
    ).toEqual(deny({ kind: 'hidden' }));
  });
});

describe('canDeleteThreadResponse', () => {
  it.each([
    ['its author', member, member.staffId, channel('public', true)],
    ['a company Admin in an Archived channel', admin, someoneElse, channel('public', true, true)],
  ])('allows %s', (_name, actor, authorId, target) => {
    expect(canDeleteThreadResponse(actor, target, { authorId })).toEqual(allow());
  });

  it('refuses a member who isn’t the author', () => {
    expect(
      canDeleteThreadResponse(member, channel('public', true), { authorId: someoneElse }),
    ).toEqual(
      deny({
        kind: 'refused',
        message: 'Only its author or a company Admin can delete this Thread Response.',
      }),
    );
  });

  it('refuses the author in an Archived channel', () => {
    expect(
      canDeleteThreadResponse(member, channel('public', true, true), { authorId: member.staffId }),
    ).toEqual(
      deny({
        kind: 'refused',
        message: 'This Channel is archived, so only a company Admin can delete in it.',
      }),
    );
  });
});
