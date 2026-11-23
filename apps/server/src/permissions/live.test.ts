import type { LiveEvent } from '@ping/shared';
import { describe, expect, it } from 'vitest';
import type { Actor } from './actor';
import { allow, deny } from './decision';
import { canOpenLiveStream, canReceiveLiveEvent } from './live';

const member: Actor = { staffId: '00000000-0000-4000-8000-0000000000a1', role: 'member' };
const admin: Actor = { staffId: '00000000-0000-4000-8000-0000000000a2', role: 'admin' };

const channelId = '00000000-0000-4000-8000-0000000000c1';
const threadId = '00000000-0000-4000-8000-0000000000d1';
const threadCreated: LiveEvent = { kind: 'thread.created', channelId, threadId };

const publicChannel = { visibility: 'public' as const, isMember: false };
const privateChannel = { visibility: 'private' as const, isMember: false };
const privateAsMember = { visibility: 'private' as const, isMember: true };

describe('canOpenLiveStream', () => {
  it.each([member, admin])('lets every active Staff member open the stream', (actor) => {
    expect(canOpenLiveStream(actor)).toEqual(allow());
  });
});

describe('canReceiveLiveEvent', () => {
  it('sends a Public channel’s events to everyone', () => {
    expect(canReceiveLiveEvent(member, threadCreated, publicChannel)).toEqual(allow());
  });

  it('sends a Private channel’s events to its members', () => {
    expect(canReceiveLiveEvent(member, threadCreated, privateAsMember)).toEqual(allow());
  });

  it.each([
    ['a Member', member],
    ['a company Admin', admin],
  ])('hides a Private channel’s events from %s who isn’t in it', (_who, actor) => {
    expect(canReceiveLiveEvent(actor, threadCreated, privateChannel)).toEqual(
      deny({ kind: 'hidden' }),
    );
  });

  it('hides the events of a Channel the database didn’t show the actor', () => {
    expect(canReceiveLiveEvent(admin, threadCreated, undefined)).toEqual(deny({ kind: 'hidden' }));
  });

  it('tells someone removed from a Private channel that their membership changed', () => {
    const removed: LiveEvent = { kind: 'channel.changed', channelId, staffId: member.staffId };
    expect(canReceiveLiveEvent(member, removed, undefined)).toEqual(allow());
  });

  it('keeps a membership change in a Private channel from everyone else outside it', () => {
    const removed: LiveEvent = { kind: 'channel.changed', channelId, staffId: member.staffId };
    expect(canReceiveLiveEvent(admin, removed, undefined)).toEqual(deny({ kind: 'hidden' }));
  });

  it('sends changes to Staff members to everyone, since everyone can read them', () => {
    const changed: LiveEvent = { kind: 'staff.changed', staffId: admin.staffId };
    expect(canReceiveLiveEvent(member, changed, undefined)).toEqual(allow());
  });
});
