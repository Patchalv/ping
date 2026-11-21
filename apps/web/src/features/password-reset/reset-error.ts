// What the password-reset pages say when Better Auth refuses. Better Auth's own messages
// are English for developers, so each refusal gets Ping's wording here.
import { PASSWORD_MESSAGES } from '@ping/shared';

type Refused = { status: number; code?: string | undefined };

const TOO_MANY = 'Too many attempts. Wait a minute, then try again.';
const SOMETHING_WRONG = 'Something went wrong. Try again.';

/** The forgot-password form's error. Any 200 shows the same answer, so only failures land here. */
export function forgotPasswordErrorMessage(error: Refused): string {
  return error.status === 429 ? TOO_MANY : SOMETHING_WRONG;
}

/** Better Auth's codes for a refused password, shown on the password field. */
const PASSWORD_REFUSALS: Record<string, string> = {
  PASSWORD_COMPROMISED: PASSWORD_MESSAGES.breached,
  PASSWORD_TOO_SHORT: PASSWORD_MESSAGES.tooShort,
  PASSWORD_TOO_LONG: PASSWORD_MESSAGES.tooLong,
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
