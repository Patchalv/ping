// Sign-in: the form's schema. Better Auth owns the route and checks the credentials; this
// only catches the obvious mistakes before a round trip.
import { z } from 'zod';

/** The sign-in form. */
export const signInBody = z.object({
  email: z
    .string({ error: 'Enter your email address.' })
    .trim()
    .min(1, 'Enter your email address.')
    .pipe(z.email({ error: 'Enter an email address like name@example.com.' })),
  // Not trimmed: spaces can be part of a password.
  password: z.string({ error: 'Enter your password.' }).min(1, 'Enter your password.'),
});
export type SignInBody = z.input<typeof signInBody>;
