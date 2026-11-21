// Sign-in and password reset: the forms' schemas. Better Auth owns the routes and checks
// the credentials and tokens; these only catch the obvious mistakes before a round trip.
import { z } from 'zod';

/** product.md › Sign-in: at least 12 characters, and not in a known breach. */
export const PASSWORD_MIN = 12;

const email = z
  .string({ error: 'Enter your email address.' })
  .trim()
  .min(1, 'Enter your email address.')
  .pipe(z.email({ error: 'Enter an email address like name@example.com.' }));

/**
 * A password being set: on accepting an invite or resetting. Not trimmed: spaces can be
 * part of a password. The server also refuses a breached one.
 */
export const newPassword = z
  .string({ error: 'Choose a password.' })
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters.`)
  .max(128, 'Keep the password to 128 characters or fewer.');

/** The sign-in form. */
export const signInBody = z.object({
  email,
  // Not trimmed: spaces can be part of a password.
  password: z.string({ error: 'Enter your password.' }).min(1, 'Enter your password.'),
});
export type SignInBody = z.input<typeof signInBody>;

/** The forgot-password form. Lowercased, as Better Auth matches emails. */
export const forgotPasswordBody = z.object({
  email: email.transform((value) => value.toLowerCase()),
});
export type ForgotPasswordBody = z.input<typeof forgotPasswordBody>;

/** The set-password form a reset link opens. The token comes from the link. */
export const newPasswordBody = z.object({ password: newPassword });
export type NewPasswordBody = z.input<typeof newPasswordBody>;
