import { describe, expect, it } from 'vitest';
import { ForbiddenError, NotFoundError } from '../lib/errors';
import type { Actor } from './actor';
import {
  canCreateChannel,
  canListOwnChannels,
  canReadChannel,
  requireCanCreateChannel,
  requireCanReadChannel,
} from './channel';
import { allow, deny, requireAllowed } from './decision';

const member: Actor = { staffId: '00000000-0000-4000-8000-0000000000a1', role: 'member' };
const admin: Actor = { staffId: '00000000-0000-4000-8000-0000000000a2', role: 'admin' };

const publicChannel = { visibility: 'public' as const, isMember: false };
const privateChannel = { visibility: 'private' as const, isMember: false };
const privateAsMember = { visibility: 'private' as const, isMember: true };

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
