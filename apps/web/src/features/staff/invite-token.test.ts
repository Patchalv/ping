import { describe, expect, it } from 'vitest';
import { inviteTokenFromHash } from './invite-token';

describe('inviteTokenFromHash', () => {
  it('reads the token from the link’s fragment', () => {
    expect(inviteTokenFromHash('#token=abc_DEF-123')).toBe('abc_DEF-123');
  });

  it('is empty when the link has no token', () => {
    expect(inviteTokenFromHash('')).toBe('');
    expect(inviteTokenFromHash('#other=1')).toBe('');
  });
});
