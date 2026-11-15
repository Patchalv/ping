import { describe, expect, it } from 'vitest';
import { signInBody } from './auth';

describe('signInBody', () => {
  it('accepts an email and password, trimming the email', () => {
    expect(signInBody.parse({ email: ' laura@example.com ', password: ' secret ' })).toEqual({
      email: 'laura@example.com',
      password: ' secret ',
    });
  });

  // Every rule a Staff member can trip says what to do, in plain English.
  it.each([
    ['an empty email', { email: '', password: 'x' }, 'email', 'Enter your email address.'],
    [
      'an email without an @',
      { email: 'laura', password: 'x' },
      'email',
      'Enter an email address like name@example.com.',
    ],
    [
      'an empty password',
      { email: 'a@example.com', password: '' },
      'password',
      'Enter your password.',
    ],
  ])('refuses %s', (_, input, path, message) => {
    const result = signInBody.safeParse(input);
    expect(result.success).toBe(false);
    expect(result.error?.issues).toEqual([expect.objectContaining({ path: [path], message })]);
  });
});
