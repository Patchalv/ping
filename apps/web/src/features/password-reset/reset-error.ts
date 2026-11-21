// What the password-reset pages say when Better Auth refuses. Better Auth's own messages
// are English for developers, so each refusal gets Ping's wording here.
import { PASSWORD_MIN } from '@ping/shared';

type Refused = { status: number; code?: string | undefined };

const TOO_MANY = 'Too many attempts. Wait a minute, then try again.';
const SOMETHING_WRONG = 'Something went wrong. Try again.';

/** The forgot-password form's error. Any 200 shows the same answer, so only failures land here. */
export function forgotPasswordErrorMessage(error: Refused): string {
  return error.status === 429 ? TOO_MANY : SOMETHING_WRONG;
}

/** Messages for a password the server refused, shown on the password field. */
const PASSWORD_REFUSALS: Record<string, string> = {
  PASSWORD_COMPROMISED: 'That password has appeared in a data breach. Choose a different one.',
  PASSWORD_TOO_SHORT: `Use at least ${PASSWORD_MIN} characters.`,
  PASSWORD_TOO_LONG: 'Keep the password to 128 characters or fewer.',
};

/**
 * How the set-password page shows a refused reset: a dead link (expired, used or
 * unknown), a problem with the password, or a message for the whole form.
 */
export function resetPasswordRefusal(
  error: Refused,
): { kind: 'dead-link' } | { kind: 'password' | 'form'; message: string } {
  if (error.code === 'INVALID_TOKEN') return { kind: 'dead-link' };
  const passwordMessage = error.code ? PASSWORD_REFUSALS[error.code] : undefined;
  if (passwordMessage) return { kind: 'password', message: passwordMessage };
  if (error.status === 503) {
    return {
      kind: 'form',
      message: 'We couldn’t check your password just now. Try again in a minute.',
    };
  }
  return { kind: 'form', message: error.status === 429 ? TOO_MANY : SOMETHING_WRONG };
}
