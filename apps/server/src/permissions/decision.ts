// What every decision function returns (ADR 0002). Decisions are pure, so they're
// unit-tested; the require… helpers turn a deny into a thrown typed error.
import { ForbiddenError, NotFoundError } from '../lib/errors';

/**
 * Why an action is refused:
 * - `hidden`: the actor can't see the Channel, so it answers 404 and its existence
 *   doesn't leak;
 * - `refused`: the actor can see it but can't act, which answers 403 with a message the
 *   UI shows.
 */
type DenyReason = { kind: 'hidden' } | { kind: 'refused'; message: string };

export type Decision = { allow: true } | { allow: false; reason: DenyReason };

export const allow = (): Decision => ({ allow: true });
export const deny = (reason: DenyReason): Decision => ({ allow: false, reason });

/** Throws NotFoundError or ForbiddenError for a deny. */
export function requireAllowed(decision: Decision): void {
  if (decision.allow) return;
  switch (decision.reason.kind) {
    case 'hidden':
      throw new NotFoundError();
    case 'refused':
      throw new ForbiddenError(decision.reason.message);
  }
}
