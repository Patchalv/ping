import { describe, expect, it } from 'vitest';
import { forgotPasswordErrorMessage, resetPasswordRefusal } from './reset-error';

describe('forgotPasswordErrorMessage', () => {
  it('asks the person to wait when they’ve asked too often', () => {
    expect(forgotPasswordErrorMessage({ status: 429 })).toBe(
      'Too many attempts. Wait a minute, then try again.',
    );
  });

  it('says something went wrong otherwise', () => {
    expect(forgotPasswordErrorMessage({ status: 500 })).toBe('Something went wrong. Try again.');
  });
});

describe('resetPasswordRefusal', () => {
  it('treats an expired, used or unknown token as a dead link', () => {
    expect(resetPasswordRefusal({ status: 400, code: 'INVALID_TOKEN' })).toEqual({
      kind: 'dead-link',
    });
  });

  it.each([
    [
      'PASSWORD_COMPROMISED',
      'That password has appeared in a data breach. Choose a different one.',
    ],
    ['PASSWORD_TOO_SHORT', 'Use at least 12 characters.'],
    ['PASSWORD_TOO_LONG', 'Keep the password to 128 characters or fewer.'],
  ])('puts %s on the password field', (code, message) => {
    expect(resetPasswordRefusal({ status: 400, code })).toEqual({ kind: 'password', message });
  });

  it.each([
    [503, undefined, 'We couldn’t check your password just now. Try again in a minute.'],
    [429, undefined, 'Too many attempts. Wait a minute, then try again.'],
    [500, undefined, 'Something went wrong. Try again.'],
  ])('shows %s as a form error', (status, code, message) => {
    expect(resetPasswordRefusal({ status, code })).toEqual({ kind: 'form', message });
  });
});
