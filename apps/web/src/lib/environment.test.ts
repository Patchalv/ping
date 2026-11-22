import { describe, expect, it } from 'vitest';
import { environmentLabel } from './environment';

describe('environmentLabel', () => {
  it('labels staging', () => {
    expect(environmentLabel('staging')).toBe('Staging');
  });

  it.each([undefined, 'production', 'local', ''])('shows nothing for %s', (content) => {
    expect(environmentLabel(content)).toBeNull();
  });
});
