import { describe, expect, it } from 'vitest';
import {
  acceptInviteBody,
  changeEmailBody,
  changeNameBody,
  emailChangeTokenBody,
  inviteStaffBody,
  inviteTokenBody,
  staffParams,
} from './staff';

const messageFor = (
  result: { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } },
  path: string,
) => result.error?.issues.find((issue) => issue.path.join('.') === path)?.message;

describe('inviteStaffBody', () => {
  it('trims the name and lowercases the email', () => {
    expect(
      inviteStaffBody.parse({
        name: '  Rosa Ferrer ',
        email: ' Rosa.Ferrer@Example.com ',
        role: 'admin',
      }),
    ).toEqual({ name: 'Rosa Ferrer', email: 'rosa.ferrer@example.com', role: 'admin' });
  });

  it.each([
    [
      'an empty name',
      { name: ' ', email: 'a@example.com', role: 'member' },
      'name',
      'Enter their name.',
    ],
    [
      'a long name',
      { name: 'x'.repeat(81), email: 'a@example.com', role: 'member' },
      'name',
      'Keep the name to 80 characters or fewer.',
    ],
    [
      'an empty email',
      { name: 'Rosa', email: '', role: 'member' },
      'email',
      'Enter their email address.',
    ],
    [
      'a malformed email',
      { name: 'Rosa', email: 'rosa', role: 'member' },
      'email',
      'Enter an email address like name@example.com.',
    ],
    ['no role', { name: 'Rosa', email: 'a@example.com' }, 'role', 'Choose Admin or Member.'],
  ])('refuses %s in plain English', (_name, input, path, message) => {
    expect(messageFor(inviteStaffBody.safeParse(input), path)).toBe(message);
  });
});

describe('acceptInviteBody', () => {
  it('keeps the password as typed, spaces included', () => {
    expect(acceptInviteBody.parse({ token: 'tok', password: ' twelve chars ' }).password).toBe(
      ' twelve chars ',
    );
  });

  it('asks for at least 12 characters', () => {
    expect(
      messageFor(acceptInviteBody.safeParse({ token: 'tok', password: 'short' }), 'password'),
    ).toBe('Use at least 12 characters.');
  });

  it('refuses a missing token', () => {
    expect(inviteTokenBody.safeParse({ token: '' }).success).toBe(false);
  });
});

describe('staffParams', () => {
  it('needs a UUID', () => {
    expect(staffParams.safeParse({ staffId: 'nope' }).success).toBe(false);
  });
});

describe('changeNameBody', () => {
  it('trims the name', () => {
    expect(changeNameBody.parse({ name: '  Rosa Ferrer ' })).toEqual({ name: 'Rosa Ferrer' });
  });

  it.each([
    ['an empty name', { name: '  ' }, 'Enter your name.'],
    ['a long name', { name: 'x'.repeat(81) }, 'Keep your name to 80 characters or fewer.'],
    ['no name', {}, 'Enter your name.'],
  ])('refuses %s', (_case, body, message) => {
    expect(messageFor(changeNameBody.safeParse(body), 'name')).toBe(message);
  });
});

describe('changeEmailBody', () => {
  it('trims and lowercases the email', () => {
    expect(changeEmailBody.parse({ email: ' Rosa@Example.COM ' })).toEqual({
      email: 'rosa@example.com',
    });
  });

  it.each([
    ['an empty email', { email: '' }, 'Enter your new email address.'],
    ['a malformed email', { email: 'rosa@' }, 'Enter an email address like name@example.com.'],
  ])('refuses %s', (_case, body, message) => {
    expect(messageFor(changeEmailBody.safeParse(body), 'email')).toBe(message);
  });
});

describe('emailChangeTokenBody', () => {
  it('refuses an empty token', () => {
    expect(messageFor(emailChangeTokenBody.safeParse({ token: '' }), 'token')).toBe(
      'That link isn’t complete. Open it again from the email.',
    );
  });
});
