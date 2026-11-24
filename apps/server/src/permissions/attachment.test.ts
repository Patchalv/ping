import { ATTACHMENT_MESSAGES } from '@ping/shared';
import { describe, expect, it } from 'vitest';
import type { Actor } from './actor';
import { canAddAttachment, canAttach, canDownloadAttachment } from './attachment';
import { allow, deny } from './decision';
import type { ThreadChannelAccess } from './thread';

const member: Actor = { staffId: '00000000-0000-4000-8000-0000000000a1', role: 'member' };
const admin: Actor = { staffId: '00000000-0000-4000-8000-0000000000a2', role: 'admin' };

const channel = (overrides: Partial<ThreadChannelAccess> = {}): ThreadChannelAccess => ({
  visibility: 'public',
  isMember: true,
  isArchived: false,
  ...overrides,
});

describe('canAddAttachment', () => {
  it('allows a member, who can post, in a Public or Private channel', () => {
    expect(canAddAttachment(member, channel())).toEqual(allow());
    expect(canAddAttachment(member, channel({ visibility: 'private' }))).toEqual(allow());
  });

  it('allows a company Admin who isn’t a member of a Public channel: they can edit there', () => {
    expect(canAddAttachment(admin, channel({ isMember: false }))).toEqual(allow());
  });

  it('refuses a non-member Member of a Public channel', () => {
    expect(canAddAttachment(member, channel({ isMember: false }))).toEqual(
      deny({ kind: 'refused', message: 'Join this Channel to attach files in it.' }),
    );
  });

  it('hides a Private channel the actor isn’t in, Admins included', () => {
    for (const actor of [member, admin]) {
      expect(canAddAttachment(actor, channel({ visibility: 'private', isMember: false }))).toEqual(
        deny({ kind: 'hidden' }),
      );
    }
  });

  it('refuses everyone in an Archived channel, where nothing is posted or edited', () => {
    for (const actor of [member, admin]) {
      expect(canAddAttachment(actor, channel({ isArchived: true }))).toEqual(
        deny({
          kind: 'refused',
          message: 'This Channel is archived, so nobody can attach files in it.',
        }),
      );
    }
  });
});

describe('canDownloadAttachment', () => {
  it('allows anyone who can read the Thread, Archived channels included', () => {
    expect(canDownloadAttachment(member, channel({ isMember: false }))).toEqual(allow());
    expect(canDownloadAttachment(member, channel({ isArchived: true }))).toEqual(allow());
    expect(canDownloadAttachment(member, channel({ visibility: 'private' }))).toEqual(allow());
  });

  it('hides a Private channel’s Attachments from non-members, Admins included', () => {
    for (const actor of [member, admin]) {
      expect(
        canDownloadAttachment(actor, channel({ visibility: 'private', isMember: false })),
      ).toEqual(deny({ kind: 'hidden' }));
    }
  });
});

describe('canAttach', () => {
  it('allows attaching the actor’s own pending Attachments, up to 5 on a post', () => {
    expect(canAttach({ requested: 5, available: 5, alreadyAttached: 0 })).toEqual(allow());
    expect(canAttach({ requested: 2, available: 2, alreadyAttached: 3 })).toEqual(allow());
    expect(canAttach({ requested: 0, available: 0, alreadyAttached: 5 })).toEqual(allow());
  });

  it('refuses one that isn’t the actor’s pending Attachment: someone else’s, or attached', () => {
    expect(canAttach({ requested: 2, available: 1, alreadyAttached: 0 })).toEqual(
      deny({ kind: 'refused', message: ATTACHMENT_MESSAGES.unavailable }),
    );
  });

  it('refuses going past 5 on one post, counting the ones it already has', () => {
    expect(canAttach({ requested: 3, available: 3, alreadyAttached: 3 })).toEqual(
      deny({ kind: 'refused', message: ATTACHMENT_MESSAGES.tooMany }),
    );
  });
});
