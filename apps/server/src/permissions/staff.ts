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
