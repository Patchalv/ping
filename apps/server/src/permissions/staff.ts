// Staff members (permissions.md › Company roles). Inviting, Resend, Cancel and seeing
// Invited Staff members are for Admins only.
import type { Actor } from './actor';
import { allow, type Decision, deny, requireAllowed } from './decision';

/** Invite someone, and Resend or Cancel an invite. */
export function canManageInvites(actor: Actor): Decision {
  if (actor.role === 'admin') return allow();
  return deny({ kind: 'refused', message: 'Only Admins can invite Staff members.' });
}

/** The Admins' Staff members screen, which lists Invited people too. */
export function canListStaffMembers(actor: Actor): Decision {
  if (actor.role === 'admin') return allow();
  return deny({ kind: 'refused', message: 'Only Admins can manage Staff members.' });
}

/** Anyone can read their own role, so the SPA knows which controls to show. */
export function canReadOwnStaffMember(_actor: Actor): Decision {
  return allow();
}

/**
 * Change a display name or email: your own only, Admins included (permissions.md › Staff
 * members). An Admin who could change someone's email could reset their password and sign
 * in as them.
 */
export function canChangeProfile(actor: Actor, targetStaffId: string): Decision {
  if (actor.staffId === targetStaffId) return allow();
  return deny({ kind: 'refused', message: 'You can only change your own name and email.' });
}

export type StaffManagementAction = 'changeRole' | 'deactivate' | 'reactivate';

const LAST_ADMIN: Record<StaffManagementAction, string> = {
  changeRole: 'You’re the only active Admin, so you can’t change your own role.',
  deactivate: 'You’re the only active Admin, so you can’t Deactivate yourself.',
  reactivate: 'You’re already active.',
};

const OWN_ROW: Record<StaffManagementAction, string> = {
  changeRole: 'Ask another Admin to change your role.',
  deactivate: 'Ask another Admin to Deactivate you.',
  reactivate: 'You’re already active.',
};

/**
 * Change a Staff member's role, Deactivate or reactivate them: Admins only (permissions.md
 * › Staff members). `activeAdminIds` is read under the staff-management lock, so an Admin
 * demoted by a request that committed first is refused, and two Admins can't demote each
 * other at once. Nobody changes their own row, which row-level security enforces too: for
 * the last active Admin that is what keeps Spark from having none.
 */
export function canManageStaffMember(
  actor: Actor,
  input: {
    action: StaffManagementAction;
    targetStaffId: string;
    activeAdminIds: readonly string[];
  },
): Decision {
  if (actor.role !== 'admin' || !input.activeAdminIds.includes(actor.staffId)) {
    return deny({ kind: 'refused', message: 'Only Admins can manage Staff members.' });
  }
  if (input.targetStaffId !== actor.staffId) return allow();
  if (input.action !== 'reactivate' && input.activeAdminIds.length <= 1) {
    return deny({
      kind: 'refused',
      message: `${LAST_ADMIN[input.action]} Make someone else an Admin first.`,
    });
  }
  return deny({ kind: 'refused', message: OWN_ROW[input.action] });
}

export function requireCanManageStaffMember(
  actor: Actor,
  input: Parameters<typeof canManageStaffMember>[1],
): void {
  requireAllowed(canManageStaffMember(actor, input));
}

export function requireCanChangeProfile(actor: Actor, targetStaffId: string): void {
  requireAllowed(canChangeProfile(actor, targetStaffId));
}

export function requireCanManageInvites(actor: Actor): void {
  requireAllowed(canManageInvites(actor));
}

export function requireCanListStaffMembers(actor: Actor): void {
  requireAllowed(canListStaffMembers(actor));
}

export function requireCanReadOwnStaffMember(actor: Actor): void {
  requireAllowed(canReadOwnStaffMember(actor));
}
