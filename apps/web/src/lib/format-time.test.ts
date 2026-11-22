import { describe, expect, it } from 'vitest';
import { formatPostedAt } from './format-time';

// Local times, so the expectations hold in any time zone.
const now = new Date(2026, 10, 22, 17, 30);

describe('formatPostedAt', () => {
  it('shows the time for today', () => {
    expect(formatPostedAt(new Date(2026, 10, 22, 9, 5).toISOString(), now)).toBe('09:05');
  });

  it('shows "Yesterday" and the time for yesterday', () => {
    expect(formatPostedAt(new Date(2026, 10, 21, 23, 59).toISOString(), now)).toBe(
      'Yesterday 23:59',
    );
  });

  it('shows the day and month earlier this year', () => {
    expect(formatPostedAt(new Date(2026, 2, 4, 12, 0).toISOString(), now)).toBe('4 Mar');
  });

  it('adds the year for an earlier year', () => {
    expect(formatPostedAt(new Date(2025, 11, 31, 12, 0).toISOString(), now)).toBe('31 Dec 2025');
  });
});
