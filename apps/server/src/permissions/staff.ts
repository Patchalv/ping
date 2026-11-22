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

/** What an Admin is doing to a Staff member, and what the decision needs to know. */
export type StaffManagement = {
  action: 'changeRole' | 'deactivate' | 'reactivate';
  targetStaffId: string;
  /** Read under the staff-management lock, so it can't be stale. */
  activeAdminIds: readonly string[];
};

/** Why an Admin can't do it to their own row: as the last active Admin, or otherwise. */
const OWN_ROW: Record<StaffManagement['action'], { lastAdmin: string; otherwise: string }> = {
  changeRole: {
    lastAdmin:
      'You’re the only active Admin, so you can’t change your own role. Make someone else an Admin first.',
    otherwise: 'Ask another Admin to change your role.',
  },
  deactivate: {
    lastAdmin:
      'You’re the only active Admin, so you can’t Deactivate yourself. Make someone else an Admin first.',
    otherwise: 'Ask another Admin to Deactivate you.',
  },
  // Unreachable through the app (a Deactivated Staff member can't sign in), but total.
  reactivate: { lastAdmin: 'You’re already active.', otherwise: 'You’re already active.' },
};

/**
 * Change a Staff member's role, Deactivate or reactivate them: Admins only (permissions.md
 * › Staff members). `activeAdminIds` is read under the staff-management lock, so an Admin
 * demoted by a request that committed first is refused, and two Admins can't demote each
 * other at once. Nobody changes their own row, which row-level security enforces too: for
 * the last active Admin that is what keeps Spark from having none.
 */
export function canManageStaffMember(actor: Actor, input: StaffManagement): Decision {
  if (actor.role !== 'admin' || !input.activeAdminIds.includes(actor.staffId)) {
    return deny({ kind: 'refused', message: 'Only Admins can manage Staff members.' });
  }
  if (input.targetStaffId !== actor.staffId) return allow();
  const messages = OWN_ROW[input.action];
  return deny({
    kind: 'refused',
    message: input.activeAdminIds.length <= 1 ? messages.lastAdmin : messages.otherwise,
  });
}

export function requireCanManageStaffMember(actor: Actor, input: StaffManagement): void {
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
