import { describe, expect, it } from 'vitest';
import { forgotPasswordBody, newPasswordBody, signInBody } from './auth';

describe('forgotPasswordBody', () => {
  it('trims and lowercases the email', () => {
    expect(forgotPasswordBody.parse({ email: ' Laura@Example.com ' })).toEqual({
      email: 'laura@example.com',
    });
  });

  it.each([
    ['an empty email', '', 'Enter your email address.'],
    ['an email without an @', 'laura', 'Enter an email address like name@example.com.'],
  ])('refuses %s', (_, email, message) => {
    const result = forgotPasswordBody.safeParse({ email });
    expect(result.error?.issues).toEqual([expect.objectContaining({ path: ['email'], message })]);
  });
});

describe('newPasswordBody', () => {
  it('keeps spaces, which can be part of a password', () => {
    expect(newPasswordBody.parse({ password: ' twelve chars ' })).toEqual({
      password: ' twelve chars ',
    });
  });

  it.each([
    ['an empty password', '', 'Use at least 12 characters.'],
    ['an 11-character password', 'a'.repeat(11), 'Use at least 12 characters.'],
    ['a 129-character password', 'a'.repeat(129), 'Keep the password to 128 characters or fewer.'],
  ])('refuses %s', (_, password, message) => {
    const result = newPasswordBody.safeParse({ password });
    expect(result.error?.issues).toEqual([
      expect.objectContaining({ path: ['password'], message }),
    ]);
  });
});

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
