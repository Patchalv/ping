import { ATTACHMENT_MESSAGES } from '@ping/shared';
import { describe, expect, it } from 'vitest';
import type { Actor } from './actor';
import {
  canAddAttachment,
  canAttach,
  canDownloadAttachment,
  canRemoveAttachment,
  type RemoveAccess,
  withRemoveActions,
} from './attachment';
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
  const attachedIn = (access: ThreadChannelAccess) => ({
    channel: access,
    uploaderId: '00000000-0000-4000-8000-0000000000b1',
  });

  it('allows anyone who can read the Thread, Archived channels included', () => {
    expect(canDownloadAttachment(member, attachedIn(channel({ isMember: false })))).toEqual(
      allow(),
    );
    expect(canDownloadAttachment(member, attachedIn(channel({ isArchived: true })))).toEqual(
      allow(),
    );
    expect(canDownloadAttachment(member, attachedIn(channel({ visibility: 'private' })))).toEqual(
      allow(),
    );
  });

  it('hides a Private channel’s Attachments from non-members, Admins included', () => {
    for (const actor of [member, admin]) {
      expect(
        canDownloadAttachment(
          actor,
          attachedIn(channel({ visibility: 'private', isMember: false })),
        ),
      ).toEqual(deny({ kind: 'hidden' }));
    }
  });

  it('allows a pending Attachment to its uploader only, hiding it from everyone else', () => {
    const pending = { channel: null, uploaderId: member.staffId };
    expect(canDownloadAttachment(member, pending)).toEqual(allow());
    expect(canDownloadAttachment(admin, pending)).toEqual(deny({ kind: 'hidden' }));
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

describe('canRemoveAttachment', () => {
  const removal = (
    overrides: Partial<RemoveAccess['channel']> = {},
    uploaderId = '00000000-0000-4000-8000-0000000000b1',
  ): RemoveAccess => ({
    channel: { ...channel(), isChannelAdmin: false, ...overrides },
    uploaderId,
  });

  it('allows its uploader, even after they left a Public channel', () => {
    expect(canRemoveAttachment(member, removal({}, member.staffId))).toEqual(allow());
    expect(canRemoveAttachment(member, removal({ isMember: false }, member.staffId))).toEqual(
      allow(),
    );
  });

  it('allows the Channel’s admins and company Admins to remove anyone’s', () => {
    expect(canRemoveAttachment(member, removal({ isChannelAdmin: true }))).toEqual(allow());
    expect(canRemoveAttachment(admin, removal({ isMember: false }))).toEqual(allow());
  });

  it('allows removal in an Archived channel, so personal data can always come down', () => {
    expect(canRemoveAttachment(member, removal({ isArchived: true }, member.staffId))).toEqual(
      allow(),
    );
    expect(canRemoveAttachment(admin, removal({ isArchived: true }))).toEqual(allow());
  });

  it('refuses another member', () => {
    expect(canRemoveAttachment(member, removal())).toEqual(
      deny({
        kind: 'refused',
        message:
          'Only the person who added this file, the Channel’s admins and company Admins can remove it.',
      }),
    );
  });

  it('hides a Private channel the actor isn’t in, Admins and the uploader included', () => {
    const hidden = { visibility: 'private', isMember: false } as const;
    expect(canRemoveAttachment(admin, removal(hidden))).toEqual(deny({ kind: 'hidden' }));
    expect(canRemoveAttachment(member, removal(hidden, member.staffId))).toEqual(
      deny({ kind: 'hidden' }),
    );
  });
});

describe('withRemoveActions', () => {
  it('marks which Attachments the actor may remove, and drops who uploaded them', () => {
    const access = { ...channel(), isChannelAdmin: false };
    const mine = { id: 'a', uploaderId: member.staffId };
    const theirs = { id: 'b', uploaderId: admin.staffId };
    expect(withRemoveActions(member, access, [mine, theirs])).toEqual([
      { id: 'a', canRemove: true },
      { id: 'b', canRemove: false },
    ]);
  });
});
