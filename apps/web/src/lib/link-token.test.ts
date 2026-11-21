import { describe, expect, it } from 'vitest';
import { tokenFromHash } from './link-token';

describe('tokenFromHash', () => {
  it('reads the token from an invite or reset link’s fragment', () => {
    expect(tokenFromHash('#token=abc_DEF-123')).toBe('abc_DEF-123');
  });

  it('is empty when the link has no token', () => {
    expect(tokenFromHash('')).toBe('');
    expect(tokenFromHash('#other=1')).toBe('');
  });
});
