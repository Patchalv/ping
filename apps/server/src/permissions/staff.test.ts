import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '../lib/errors';
import type { Actor } from './actor';
import { allow, deny } from './decision';
import {
  canChangeProfile,
  canListStaffMembers,
  canManageInvites,
  canReadOwnStaffMember,
  requireCanChangeProfile,
  requireCanListStaffMembers,
  requireCanManageInvites,
} from './staff';

const member: Actor = { staffId: '00000000-0000-4000-8000-0000000000a1', role: 'member' };
const admin: Actor = { staffId: '00000000-0000-4000-8000-0000000000a2', role: 'admin' };

describe('canManageInvites (invite, Resend, Cancel)', () => {
  it('allows an Admin', () => {
    expect(canManageInvites(admin)).toEqual(allow());
  });

  it('refuses a Member, with a message the UI shows', () => {
    expect(canManageInvites(member)).toEqual(
      deny({ kind: 'refused', message: 'Only Admins can invite Staff members.' }),
    );
    expect(() => requireCanManageInvites(member)).toThrow(ForbiddenError);
  });
});

describe('canListStaffMembers (with Invited people)', () => {
  it('allows an Admin', () => {
    expect(canListStaffMembers(admin)).toEqual(allow());
  });

  it('refuses a Member', () => {
    expect(canListStaffMembers(member)).toEqual(
      deny({ kind: 'refused', message: 'Only Admins can manage Staff members.' }),
    );
    expect(() => requireCanListStaffMembers(member)).toThrow(ForbiddenError);
  });
});

describe('canReadOwnStaffMember', () => {
  it.each([
    ['a Member', member],
    ['an Admin', admin],
  ])('allows %s', (_name, actor) => {
    expect(canReadOwnStaffMember(actor)).toEqual(allow());
  });
});

describe('canChangeProfile (display name and email)', () => {
  it.each([
    ['a Member', member],
    ['an Admin', admin],
  ])('allows %s to change their own', (_name, actor) => {
    expect(canChangeProfile(actor, actor.staffId)).toEqual(allow());
  });

  it.each([
    ['a Member', member, admin.staffId],
    ['an Admin', admin, member.staffId],
  ])('refuses %s changing someone else’s', (_name, actor, target) => {
    expect(canChangeProfile(actor, target)).toEqual(
      deny({ kind: 'refused', message: 'You can only change your own name and email.' }),
    );
    expect(() => requireCanChangeProfile(actor, target)).toThrow(ForbiddenError);
  });
});
