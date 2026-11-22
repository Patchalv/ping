import { describe, expect, it } from 'vitest';
import { ForbiddenError } from '../lib/errors';
import type { Actor } from './actor';
import { allow, deny } from './decision';
import {
  canChangeProfile,
  canListStaffMembers,
  canManageInvites,
  canManageStaffMember,
  canReadOwnStaffMember,
  requireCanChangeProfile,
  requireCanListStaffMembers,
  requireCanManageInvites,
  requireCanManageStaffMember,
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

describe('canManageStaffMember (change a role, Deactivate, reactivate)', () => {
  const other = '00000000-0000-4000-8000-0000000000b1';
  const actions = ['changeRole', 'deactivate', 'reactivate'] as const;

  it.each(actions)('allows an active Admin to %s someone else', (action) => {
    expect(
      canManageStaffMember(admin, {
        action,
        targetStaffId: other,
        activeAdminIds: [admin.staffId],
      }),
    ).toEqual(allow());
  });

  it.each(actions)('refuses a Member who tries to %s', (action) => {
    const input = { action, targetStaffId: other, activeAdminIds: [admin.staffId] };
    expect(canManageStaffMember(member, input)).toEqual(
      deny({ kind: 'refused', message: 'Only Admins can manage Staff members.' }),
    );
    expect(() => requireCanManageStaffMember(member, input)).toThrow(ForbiddenError);
  });

  it('refuses an Admin who was demoted while the request waited for the lock', () => {
    expect(
      canManageStaffMember(admin, {
        action: 'deactivate',
        targetStaffId: other,
        activeAdminIds: [other],
      }),
    ).toEqual(deny({ kind: 'refused', message: 'Only Admins can manage Staff members.' }));
  });

  it('refuses the last active Admin demoting themself, saying why', () => {
    expect(
      canManageStaffMember(admin, {
        action: 'changeRole',
        targetStaffId: admin.staffId,
        activeAdminIds: [admin.staffId],
      }),
    ).toEqual(
      deny({
        kind: 'refused',
        message:
          'You’re the only active Admin, so you can’t change your own role. Make someone else an Admin first.',
      }),
    );
  });

  it('refuses the last active Admin Deactivating themself, saying why', () => {
    expect(
      canManageStaffMember(admin, {
        action: 'deactivate',
        targetStaffId: admin.staffId,
        activeAdminIds: [admin.staffId],
      }),
    ).toEqual(
      deny({
        kind: 'refused',
        message:
          'You’re the only active Admin, so you can’t Deactivate yourself. Make someone else an Admin first.',
      }),
    );
  });

  it('allows an Admin who isn’t the last active Admin to change their own role', () => {
    expect(
      canManageStaffMember(admin, {
        action: 'changeRole',
        targetStaffId: admin.staffId,
        activeAdminIds: [admin.staffId, other],
      }),
    ).toEqual(allow());
  });

  it('refuses any Admin Deactivating or reactivating themself, and says who can', () => {
    const self = { targetStaffId: admin.staffId, activeAdminIds: [admin.staffId, other] };
    expect(canManageStaffMember(admin, { action: 'deactivate', ...self })).toEqual(
      deny({ kind: 'refused', message: 'Ask another Admin to Deactivate you.' }),
    );
    expect(canManageStaffMember(admin, { action: 'reactivate', ...self })).toEqual(
      deny({ kind: 'refused', message: 'You’re already active.' }),
    );
  });
});
